import { getJson } from "@/lib/http";
import type { CompanyCandidate } from "@/lib/validation";

/**
 * Complementa la búsqueda de proveedores (mayoristas/fabricantes B2B) con
 * SerpApi (motor de Google Local), que a diferencia de OSM no está limitado
 * al vocabulario fijo de tags de OpenStreetMap — busca con texto libre, así
 * que puede encontrar distribuidores que sí tienen presencia local pero
 * nunca se mapearon en OSM. Solo aplica a "proveedores", igual que Yelp
 * solo aplica a "clientes" (es el espejo de yelp.ts).
 *
 * La API de Google Local se ancla en una ciudad, no en un estado completo,
 * así que se usa la misma ciudad representativa por estado que yelp.ts.
 */
const CIUDAD_POR_ESTADO: Record<string, string> = {
  TX: "Houston, TX",
  FL: "Miami, FL",
  CA: "Los Angeles, CA",
};

const QUERY = "sporting goods wholesale distributor";
const SERPAPI_MAX_POR_LLAMADA = 20; // tamaño de página típico de Google Local

// SerpApi Local no da el sitio web propio del negocio en la respuesta
// básica (confirmado probando en vivo) — solo nombre, dirección, categoría
// y teléfono. Igual que Yelp, website queda vacío; validation.ts acepta
// el candidato igual porque sí hay dirección.
type SerpApiLocalResult = {
  title?: string;
  address?: string;
  type?: string;
  phone?: string;
};

async function searchSerpApiForEstado(estado: string, cantidad: number): Promise<CompanyCandidate[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  const location = CIUDAD_POR_ESTADO[estado] ?? `${estado}, USA`;
  const num = Math.max(1, Math.min(SERPAPI_MAX_POR_LLAMADA, cantidad));

  const url = `https://serpapi.com/search.json?engine=google_local&q=${encodeURIComponent(
    QUERY
  )}&location=${encodeURIComponent(location)}&num=${num}&api_key=${apiKey}`;

  const { status, text } = await getJson(url, {});

  if (status < 200 || status >= 300) {
    throw new Error(`SerpApi error ${status}: ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  const results: SerpApiLocalResult[] = data.local_results ?? [];

  return results
    .filter((r) => r.title)
    .map((r) => ({
      company: r.title as string,
      state: estado,
      website: "",
      email: "",
      phone: r.phone ?? "",
      social_media: "",
      category: r.type ?? "",
      source: `https://www.google.com/search?q=${encodeURIComponent(r.title as string)}`,
      address: r.address ?? "",
    }));
}

export async function searchSerpApiProveedores(
  estados: string[],
  cantidadTotal: number
): Promise<CompanyCandidate[]> {
  const porEstado = Math.max(1, Math.ceil(cantidadTotal / estados.length));
  const resultados: CompanyCandidate[] = [];

  for (const estado of estados) {
    try {
      const encontrados = await searchSerpApiForEstado(estado, porEstado);
      resultados.push(...encontrados);
    } catch {
      // SerpApi es un complemento; si falla para un estado, seguimos con los demás.
    }
  }

  return resultados;
}
