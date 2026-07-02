import { NextResponse } from "next/server";
import { getRows, SHEET_TABS } from "@/lib/google-sheets";
import { runResearchPipeline } from "@/lib/pipeline";
import type { ResearchParams } from "@/lib/research";

export const maxDuration = 300;

const ESTADOS: string[] = ["TX", "FL", "CA"];
// Desde que OSM (src/lib/osm.ts) aporta volumen gratis sin límite de cuota,
// este número ya no está atado al tope de 4/llamada de Groq (ver
// AI_CANTIDAD_MAX en pipeline.ts, que sigue capando la parte de IA aparte).
// Se mantiene moderado (no en los 1000+ que soporta el motor) porque esta
// corrida es automática y sin supervisión cada 3 días — generar cientos de
// filas nuevas sin que nadie las revise no es deseable. El volumen grande
// (1000+) queda para cuando el usuario lo pide explícitamente desde el
// formulario o el chat.
const CANTIDAD_POR_TIPO = 90;
const DIAS_ENTRE_CORRIDAS = 3;

/**
 * Vercel Cron invoca este endpoint una vez al día (ver vercel.json). En vez
 * de confiar en la sintaxis cron para expresar "cada 3 días" (imprecisa,
 * porque un paso de 3 en el día del mes se reinicia cada mes), el propio
 * endpoint revisa cuándo corrió la última investigación automática y se
 * salta si no han pasado al menos 3 días. Esto también evita gastar
 * llamadas a la API de Claude sin necesidad.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
  }

  try {
    const log = await getRows(SHEET_TABS.logInvestigaciones);
    const ultimaAutomatica = log
      .filter((r) => r.tipo === "automatica" && r.fecha)
      .map((r) => new Date(r.fecha).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => b - a)[0];

    if (ultimaAutomatica) {
      const diasDesdeUltima = (Date.now() - ultimaAutomatica) / (1000 * 60 * 60 * 24);
      if (diasDesdeUltima < DIAS_ENTRE_CORRIDAS) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: `Última corrida automática hace ${diasDesdeUltima.toFixed(1)} días, aún no toca (cada ${DIAS_ENTRE_CORRIDAS} días).`,
        });
      }
    }

    const resultados: Record<string, unknown> = {};

    for (const tipo of ["proveedores", "clientes"] as const) {
      const params: ResearchParams = { tipo, estados: ESTADOS, cantidad: CANTIDAD_POR_TIPO };
      resultados[tipo] = await runResearchPipeline(params, "automatica");
    }

    return NextResponse.json({ ok: true, skipped: false, resultados });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
