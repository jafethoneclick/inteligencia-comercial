import { getJson, sleep } from "@/lib/http";
import type { CompanyCandidate } from "@/lib/validation";

/**
 * Fuente de volumen: OpenStreetMap vía su Overpass API. A diferencia de la
 * IA (lenta, cara en tokens, limitada a pocas empresas por llamada) o Yelp
 * (limitada a un punto+radio por ciudad), Overpass puede traer todos los
 * negocios etiquetados de un tipo dado en un estado completo en una sola
 * consulta, y no requiere ninguna API key. Corre para ambos tipos
 * (proveedores y clientes), a diferencia de Yelp que solo aplica a
 * clientes — aunque para proveedores/mayoristas B2B se espera bajo
 * rendimiento, ya que ese tipo de negocio rara vez se mapea en OSM.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const TAGS_CLIENTES: readonly (readonly [string, string])[] = [
  ["shop", "sports"],
  ["shop", "outdoor"],
  ["leisure", "fitness_centre"],
  ["leisure", "sports_centre"],
  ["club", "sport"],
];

const TAGS_PROVEEDORES: readonly (readonly [string, string])[] = [
  ["shop", "wholesale"],
  ["office", "company"],
];

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
};

function buildOverpassQuery(
  estado: string,
  tags: readonly (readonly [string, string])[],
  limite: number
): string {
  const isoCode = `US-${estado.toUpperCase()}`;
  const clauses = tags
    .map(
      ([key, value]) =>
        `  node["${key}"="${value}"](area.searchArea);\n  way["${key}"="${value}"](area.searchArea);`
    )
    .join("\n");

  return `[out:json][timeout:60];
area["ISO3166-2"="${isoCode}"][admin_level=4]->.searchArea;
(
${clauses}
);
out body ${limite};`;
}

const OVERPASS_MAX_INTENTOS = 2;

// Apache (el servidor de Overpass) devuelve 406 Not Acceptable a cualquier
// POST a /api/interpreter sin importar los headers (confirmado en pruebas
// en vivo, incluso con curl puro) — por eso se manda como GET con la query
// en el querystring, igual que los ejemplos oficiales de Overpass. También
// hace falta un "Accept"/"User-Agent" explícitos: node:https no los manda
// por defecto, y sin ellos Apache también devuelve 406.
const OVERPASS_HEADERS = {
  Accept: "*/*",
  "User-Agent": "Mozilla/5.0 (compatible; InteligenciaComercialBot/1.0)",
};

/**
 * El servidor público de Overpass es compartido y puede fallar de forma
 * transitoria bajo carga (timeout, 504). Reintenta una vez antes de darse
 * por vencido, para no perder un estado completo por una falla pasajera.
 */
async function runOverpassQuery(query: string): Promise<OverpassElement[]> {
  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
  let lastError: unknown;

  for (let intento = 0; intento < OVERPASS_MAX_INTENTOS; intento++) {
    try {
      const { status, text } = await getJson(url, OVERPASS_HEADERS);
      if (status < 200 || status >= 300) {
        throw new Error(`Overpass API error ${status}: ${text.slice(0, 500)}`);
      }
      const data = JSON.parse(text);
      return data.elements ?? [];
    } catch (error) {
      lastError = error;
      if (intento < OVERPASS_MAX_INTENTOS - 1) await sleep(3000);
    }
  }

  throw lastError;
}

function buildDireccion(tags: Record<string, string>): string {
  const partes = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter(Boolean);
  return partes.join(", ");
}

function elementToCandidate(el: OverpassElement, estado: string): CompanyCandidate | null {
  const tags = el.tags ?? {};
  const empresa = tags.name;
  if (!empresa) return null; // sin nombre, no sirve como candidato

  const categoria = tags.shop ?? tags.leisure ?? tags.club ?? tags.office ?? "";
  const direccion = buildDireccion(tags);

  return {
    company: empresa,
    state: estado,
    website: tags.website ?? tags["contact:website"] ?? "",
    email: tags.email ?? tags["contact:email"] ?? "",
    phone: tags.phone ?? tags["contact:phone"] ?? "",
    social_media: "",
    category: categoria,
    source: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    address: direccion || undefined,
  };
}

/**
 * Busca negocios reales en OpenStreetMap para uno o más estados. Nunca
 * bloquea la corrida: si un estado falla (timeout, rate limit del servidor
 * público compartido de Overpass), se atrapa el error y se sigue con los
 * demás — mismo patrón de resiliencia que searchYelpClients.
 */
export async function searchOsmCompanies(
  estados: string[],
  tipo: "proveedores" | "clientes",
  cantidadTotal: number
): Promise<CompanyCandidate[]> {
  const tags = tipo === "clientes" ? TAGS_CLIENTES : TAGS_PROVEEDORES;
  const porEstado = Math.max(1, Math.ceil(cantidadTotal / estados.length));

  const resultados: CompanyCandidate[] = [];
  for (const estado of estados) {
    try {
      const query = buildOverpassQuery(estado, tags, porEstado);
      const elements = await runOverpassQuery(query);
      for (const el of elements) {
        const candidate = elementToCandidate(el, estado);
        if (candidate) resultados.push(candidate);
      }
    } catch {
      // OSM es complementario: si un estado falla, se sigue con los demás
      // sin abortar toda la corrida.
    }
  }

  return resultados;
}
