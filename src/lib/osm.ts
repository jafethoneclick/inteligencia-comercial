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

// Varias instancias públicas de la misma base de datos mundial, en orden de
// preferencia. El servidor principal (overpass-api.de) a veces rechaza
// clientes/redes completas (406 de Apache a CUALQUIER petición, incluso una
// consulta trivial con curl — confirmado en vivo en jul 2026) y kumi.systems
// se satura seguido (504). Se prueba cada instancia en orden y se usa la
// primera que responda, en vez de reintentar contra un solo servidor.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// "clientes" está enfocado solo a béisbol: en vez de filtrar por tipo de
// lugar (leisure=pitch, club=sport, etc.), se filtra directo por
// sport=baseball — ese tag lo llevan campos, clubes, centros deportivos y
// tiendas ya etiquetados como de béisbol específicamente, sin importar cuál
// sea su tag principal.
const TAGS_CLIENTES: readonly (readonly [string, string])[] = [["sport", "baseball"]];

const TAGS_PROVEEDORES: readonly (readonly [string, string])[] = [
  ["shop", "wholesale"],
  ["office", "company"],
];

// Ventana fija de lectura por estado, independiente de la `cantidad` pedida.
// Overpass no tiene offset y `out body N` devuelve siempre los mismos
// primeros N elementos (ordenados por id) — cuando el límite venía de
// `cantidad` (ej. 30 por estado), tras la primera corrida esos 30 ya estaban
// guardados y ninguna corrida volvía a aportar nuevos. Se trae una ventana
// grande de una vez y el deduplicador + el tope de nuevos del pipeline se
// encargan de que al Sheet solo entre lo que haga falta. No es ilimitada
// para no arrastrar miles de elementos en tags amplios como office=company.
const OSM_VENTANA_POR_ESTADO = 400;

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

  // El timeout de la consulta debe ser menor que OVERPASS_REQUEST_TIMEOUT_MS,
  // para que sea el servidor quien corte (con error claro) y no nosotros.
  return `[out:json][timeout:40];
area["ISO3166-2"="${isoCode}"][admin_level=4]->.searchArea;
(
${clauses}
);
out body ${limite};`;
}

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

// Un poco más que el [timeout:...] de la propia consulta Overpass: si el
// servidor no contestó en ese margen, está caído o colgado (hay mirrors que
// aceptan la conexión y nunca responden — sin este límite la corrida entera
// se queda esperando para siempre, comprobado en vivo con kumi.systems).
const OVERPASS_REQUEST_TIMEOUT_MS = 45_000;

// Índice del último mirror que respondió bien. Una corrida consulta varios
// estados seguidos; si el primer mirror está bloqueando (406), no tiene
// sentido volver a chocar con él en cada estado — se empieza directo por el
// que ya funcionó.
let mirrorPreferido = 0;

/**
 * Los servidores públicos de Overpass son compartidos y fallan seguido
 * (timeout, 504 bajo carga, o el 406 descrito en OVERPASS_URLS). Se prueba
 * cada instancia en orden hasta que una responda, para no perder un estado
 * completo porque una instancia esté caída o bloqueando.
 */
async function runOverpassQuery(query: string): Promise<OverpassElement[]> {
  let lastError: unknown;

  for (let n = 0; n < OVERPASS_URLS.length; n++) {
    const i = (mirrorPreferido + n) % OVERPASS_URLS.length;
    try {
      const url = `${OVERPASS_URLS[i]}?data=${encodeURIComponent(query)}`;
      const { status, text } = await getJson(url, OVERPASS_HEADERS, OVERPASS_REQUEST_TIMEOUT_MS);
      if (status < 200 || status >= 300) {
        throw new Error(`Overpass API error ${status}: ${text.slice(0, 500)}`);
      }
      const data = JSON.parse(text);
      mirrorPreferido = i;
      return data.elements ?? [];
    } catch (error) {
      lastError = error;
      if (n < OVERPASS_URLS.length - 1) await sleep(2000);
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

  const tipoLugar = tags.shop ?? tags.leisure ?? tags.club ?? tags.office ?? "";
  const categoria = tags.sport ? (tipoLugar ? `${tipoLugar} (${tags.sport})` : tags.sport) : tipoLugar;
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
  tipo: "proveedores" | "clientes"
): Promise<CompanyCandidate[]> {
  const tags = tipo === "clientes" ? TAGS_CLIENTES : TAGS_PROVEEDORES;

  const resultados: CompanyCandidate[] = [];
  for (const estado of estados) {
    try {
      const query = buildOverpassQuery(estado, tags, OSM_VENTANA_POR_ESTADO);
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
