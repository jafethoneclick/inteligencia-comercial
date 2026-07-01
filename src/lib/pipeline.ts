import {
  SHEET_TABS,
  appendRow,
  ensureSheetsReady,
  getRowsWithSheetIndex,
  updateRow,
  type SheetTabName,
} from "@/lib/google-sheets";
import { validateCandidate } from "@/lib/validation";
import { findDuplicate } from "@/lib/dedup";
import { researchCompanies, type ResearchParams } from "@/lib/research";
import { searchYelpClients } from "@/lib/yelp";
import { buildGoogleMapsUrl } from "@/lib/maps";

export type PipelineResult = {
  ok: true;
  nuevos: number;
  actualizados: number;
  invalidos: { empresa: string; issues: string[] }[];
  totalEncontrados: number;
};

/**
 * Corre el ciclo completo de investigación para un tipo (proveedores o
 * clientes): busca candidatos, valida, deduplica contra lo ya guardado, y
 * escribe en Sheets. Usado tanto por la búsqueda manual como por el cron
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

    const candidates = await researchCompanies(params);

    // Yelp complementa la búsqueda con IA solo para clientes potenciales
    // (tiendas, gimnasios, clubes) — es un directorio de consumo, no sirve
    // para encontrar mayoristas/fabricantes. Si falla o no hay API key, no
    // se pierde la corrida: se sigue solo con lo que ya encontró la IA.
    if (params.tipo === "clientes" && process.env.YELP_API_KEY) {
      try {
        const yelpCandidates = await searchYelpClients(params.estados, params.cantidad ?? 8);
        candidates.push(...yelpCandidates);
      } catch {
        // se ignora: Yelp es un complemento, no una dependencia dura del pipeline
      }
    }

    const existing = await getRowsWithSheetIndex(targetTab);

    let nuevos = 0;
    let actualizados = 0;
    const invalidos: { empresa: string; issues: string[] }[] = [];
    const detalle: string[] = [];

    for (const candidate of candidates) {
      const validation = await validateCandidate(candidate);
      if (!validation.valid) {
        invalidos.push({ empresa: candidate.empresa, issues: validation.issues });
        continue;
      }

      const now = new Date().toISOString();
      const duplicate = findDuplicate(candidate, existing.map((e) => e.row));
      const googleMapsUrl = buildGoogleMapsUrl(candidate.empresa, candidate.estado, candidate.direccion);

      if (duplicate) {
        const match = existing.find((e) => e.row === duplicate);
        if (match) {
          await updateRow(targetTab, match.sheetRow, {
            ...duplicate,
            ...candidate,
            fecha_validacion: duplicate.fecha_validacion || now,
            ultima_actualizacion: now,
            google_maps_url: googleMapsUrl,
          });
          actualizados++;
          detalle.push(`Actualizado: ${candidate.empresa}`);
        }
      } else {
        await appendRow(targetTab, {
          id: crypto.randomUUID(),
          ...candidate,
          fecha_validacion: now,
          ultima_actualizacion: now,
          google_maps_url: googleMapsUrl,
        });
        nuevos++;
        detalle.push(`Nuevo: ${candidate.empresa}`);
      }
    }

    await appendRow(SHEET_TABS.logInvestigaciones, {
      fecha: startedAt,
      tipo: tipoEjecucion,
      criterios: `${params.tipo} | ${params.estados.join(",")}${
        params.criterios ? " | " + params.criterios : ""
      }`,
      nuevos: String(nuevos),
      actualizados: String(actualizados),
      estado_ejecucion: "ok",
      detalle: detalle.join("; ") || "Sin cambios",
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
        fecha: startedAt,
        tipo: tipoEjecucion,
        criterios: `${params.tipo} | ${params.estados.join(",")}`,
        nuevos: "0",
        actualizados: "0",
        estado_ejecucion: "error",
        detalle: message,
      });
    } catch {
      // si ni el log se pudo escribir, seguimos y devolvemos el error original igual
    }

    throw new Error(message);
  }
}
