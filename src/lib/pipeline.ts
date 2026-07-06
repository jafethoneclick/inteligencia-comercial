import {
  SHEET_TABS,
  appendRow,
  appendRows,
  batchUpdateRows,
  ensureSheetsReady,
  getRowsWithSheetIndex,
  type SheetTabName,
} from "@/lib/google-sheets";
import { validateCandidate, type CompanyCandidate } from "@/lib/validation";
import { findDuplicate } from "@/lib/dedup";
import { researchCompanies, type ResearchParams } from "@/lib/research";
import { searchYelpClients } from "@/lib/yelp";
import { searchOsmCompanies } from "@/lib/osm";
import { searchSerpApiProveedores } from "@/lib/serpapi";
import { buildGoogleMapsUrl } from "@/lib/maps";
import { mapWithConcurrency } from "@/lib/concurrency";

export type PipelineResult = {
  ok: true;
  nuevos: number;
  actualizados: number;
  invalidos: { company: string; issues: string[] }[];
  totalEncontrados: number;
};

// La IA (Groq/Anthropic) nunca debe recibir un `cantidad` más grande que
// esto, sin importar qué tan grande sea params.cantidad — cada llamada a
// Groq cuesta cuota y tiempo, y a diferencia de OSM no puede escalar a
// cientos/miles de resultados sin agotar la cuota gratuita o el
// maxDuration. El volumen grande lo aporta OSM/Yelp/SerpApi, no la IA.
//
// OJO: con Groq este número en la práctica no tiene efecto por sí solo —
// researchWithGroq (research.ts) hace UNA llamada por estado, capada aparte
// a GROQ_MAX_POR_LLAMADA=4 (el modelo "compound" trunca la respuesta si se
// le pide más). O sea, con Groq el techo real sigue siendo ~4 por estado
// sin importar qué tan alto esté AI_CANTIDAD_MAX. Este número solo cobra
// sentido completo si se cambia a ANTHROPIC_API_KEY (researchWithAnthropic
// sí hace una sola llamada pidiendo hasta este total).
const AI_CANTIDAD_MAX = 200;

const VALIDATION_CONCURRENCY = 15;

/**
 * Corre el ciclo completo de investigación para un tipo (proveedores o
 * clientes): busca candidatos (IA + OSM + Yelp), valida, deduplica contra
 * lo ya guardado y contra lo demás de esta misma corrida, y escribe en
 * Sheets en lote. Usado tanto por la búsqueda manual como por el cron
 * automático; `tipoEjecucion` solo afecta lo que se registra en el log.
 */
export async function runResearchPipeline(
  params: ResearchParams,
  tipoEjecucion: "manual" | "automatica"
): Promise<PipelineResult> {
  const startedAt = new Date().toISOString();
  const targetTab: SheetTabName =
    params.tipo === "proveedores" ? SHEET_TABS.proveedores : SHEET_TABS.clientesPotenciales;

  try {
    await ensureSheetsReady();

    const aiParams: ResearchParams = {
      ...params,
      cantidad: Math.min(params.cantidad ?? 8, AI_CANTIDAD_MAX),
    };
    const candidates = await researchCompanies(aiParams);

    // OSM complementa la búsqueda con IA para ambos tipos — es la fuente
    // de volumen (puede devolver cientos de resultados por estado en una
    // sola consulta, sin API key). Para proveedores se espera menos
    // resultados (los mayoristas B2B rara vez se mapean en OSM). Si falla,
    // no se pierde la corrida: se sigue con lo que ya se tenía.
    try {
      const osmCandidates = await searchOsmCompanies(params.estados, params.tipo);
      candidates.push(...osmCandidates);
    } catch {
      // OSM complementa, no bloquea.
    }

    // SerpApi (Google Local) complementa proveedores — a diferencia de OSM,
    // busca con texto libre en vez de un vocabulario fijo de tags, así que
    // encuentra distribuidores/mayoristas con presencia local que OSM no
    // mapea. Es el espejo de Yelp (que solo aplica a clientes). Si falla o
    // no hay API key, no se pierde la corrida.
    if (params.tipo === "proveedores" && process.env.SERPAPI_API_KEY) {
      try {
        const serpApiCandidates = await searchSerpApiProveedores(params.estados, params.cantidad ?? 8);
        candidates.push(...serpApiCandidates);
      } catch {
        // se ignora: SerpApi es un complemento, no una dependencia dura del pipeline
      }
    }

    // Yelp complementa la búsqueda con IA solo para clientes potenciales
    // (tiendas, gimnasios, clubes) — es un directorio de consumo, no sirve
    // para encontrar mayoristas/fabricantes. Si falla o no hay API key, no
    // se pierde la corrida: se sigue solo con lo que ya se tenía.
    if (params.tipo === "clientes" && process.env.YELP_API_KEY) {
      try {
        const yelpCandidates = await searchYelpClients(params.estados);
        candidates.push(...yelpCandidates);
      } catch {
        // se ignora: Yelp es un complemento, no una dependencia dura del pipeline
      }
    }

    const existing = await getRowsWithSheetIndex(targetTab);
    const existingRowsOnly = existing.map((e) => e.row);

    const validationResults = await mapWithConcurrency(
      candidates,
      VALIDATION_CONCURRENCY,
      async (candidate) => ({ candidate, validation: await validateCandidate(candidate) })
    );

    const invalidos: { company: string; issues: string[] }[] = [];
    const validatedCandidates: CompanyCandidate[] = [];
    for (const { candidate, validation } of validationResults) {
      if (!validation.valid) {
        invalidos.push({ company: candidate.company, issues: validation.issues });
      } else {
        validatedCandidates.push(candidate);
      }
    }

    // Las fuentes traen a propósito una ventana mucho más grande que la
    // `cantidad` pedida (ver OSM_VENTANA_POR_ESTADO en osm.ts y
    // YELP_MAX_POR_CIUDAD en yelp.ts): así siempre hay negocios aún no
    // guardados entre los candidatos. Este tope es el que hace respetar la
    // `cantidad` — sin él, una corrida podría insertar cientos de filas de
    // golpe (indeseable sobre todo en la corrida automática sin supervisión).
    const maxNuevos = params.cantidad ?? 8;

    // Los candidatos llegan agrupados por fuente y por estado (toda la IA,
    // luego todo OSM de TX, FL, CA, luego todo Yelp...). Sin mezclar, el
    // tope de nuevos se llenaría siempre con la primera fuente/estado de la
    // lista y el resto jamás aportaría. Fisher-Yates para repartir el cupo.
    for (let i = validatedCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [validatedCandidates[i], validatedCandidates[j]] = [validatedCandidates[j], validatedCandidates[i]];
    }

    // Filas nuevas de esta corrida ya aceptadas, para no comparar solo
    // contra lo que ya había en Sheets sino también entre sí (ej. la misma
    // empresa apareciendo tanto por OSM como por la IA en la misma corrida).
    const seenThisRun: Record<string, string>[] = [];
    const newRowsToAppend: Record<string, string>[] = [];
    const updatesToApply: { sheetRow: number; record: Record<string, string> }[] = [];
    let nuevos = 0;
    let actualizados = 0;
    const detalle: string[] = [];

    for (const candidate of validatedCandidates) {
      const now = new Date().toISOString();
      const googleMapsUrl = buildGoogleMapsUrl(candidate.company, candidate.state, candidate.address);

      const duplicateInSheet = findDuplicate(candidate, existingRowsOnly);

      if (duplicateInSheet) {
        const match = existing.find((e) => e.row === duplicateInSheet);
        if (match) {
          updatesToApply.push({
            sheetRow: match.sheetRow,
            record: {
              ...duplicateInSheet,
              ...candidate,
              validated_at: duplicateInSheet.validated_at || now,
              updated_at: now,
              google_maps_url: googleMapsUrl,
            },
          });
          actualizados++;
          detalle.push(`Actualizado: ${candidate.company}`);
        }
        continue;
      }

      const duplicateInRun = findDuplicate(candidate, seenThisRun);
      if (duplicateInRun) {
        // Ya se va a insertar una fila equivalente en esta misma corrida
        // (ej. OSM y la IA encontraron la misma empresa) — se descarta
        // silenciosamente, no cuenta como nuevo ni como error.
        continue;
      }

      // Cupo de nuevos lleno: se descarta sin registrar nada. El negocio
      // volverá a aparecer en la ventana de una corrida futura y entrará
      // cuando haya cupo. (Los duplicados de arriba sí se siguen
      // procesando como actualizaciones aunque el cupo esté lleno.)
      if (nuevos >= maxNuevos) continue;

      const record = {
        id: crypto.randomUUID(),
        ...candidate,
        validated_at: now,
        updated_at: now,
        google_maps_url: googleMapsUrl,
      };
      newRowsToAppend.push(record);
      seenThisRun.push(record);
      nuevos++;
      detalle.push(`Nuevo: ${candidate.company}`);
    }

    await appendRows(targetTab, newRowsToAppend);
    await batchUpdateRows(targetTab, updatesToApply);

    await appendRow(SHEET_TABS.logInvestigaciones, {
      date: startedAt,
      type: tipoEjecucion,
      criteria: `${params.tipo} | ${params.estados.join(",")}${
        params.criterios ? " | " + params.criterios : ""
      }`,
      new_count: String(nuevos),
      updated_count: String(actualizados),
      run_status: "ok",
      detail: detalle.join("; ") || "Sin cambios",
    });

    return {
      ok: true,
      nuevos,
      actualizados,
      invalidos,
      totalEncontrados: candidates.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";

    try {
      await appendRow(SHEET_TABS.logInvestigaciones, {
        date: startedAt,
        type: tipoEjecucion,
        criteria: `${params.tipo} | ${params.estados.join(",")}`,
        new_count: "0",
        updated_count: "0",
        run_status: "error",
        detail: message,
      });
    } catch {
      // si ni el log se pudo escribir, seguimos y devolvemos el error original igual
    }

    throw new Error(message);
  }
}
