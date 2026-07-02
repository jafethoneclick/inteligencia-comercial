import { getJson } from "@/lib/http";
import type { CompanyCandidate } from "@/lib/validation";

/**
 * Complementa la búsqueda de clientes potenciales (tiendas, gimnasios,
 * clubes) con datos reales de Yelp: dirección exacta y teléfono verificado,
 * cosa que la búsqueda con IA no siempre consigue. Solo aplica a
 * "clientes", no a proveedores/mayoristas (Yelp es un directorio de
 * consumo, no B2B).
 *
 * La API de búsqueda de Yelp centra la búsqueda en un punto + radio (no
 * permite buscar "todo el estado" de una vez), así que se usa una ciudad
 * grande representativa de cada estado como ancla.
 */
const CIUDAD_POR_ESTADO: Record<string, string> = {
  TX: "Houston, TX",
  FL: "Miami, FL",
  CA: "Los Angeles, CA",
};

const CATEGORIAS = "sportgoods,gyms,sportsclubs";
const YELP_MAX_POR_LLAMADA = 10;

type YelpBusiness = {
  name: string;
  url?: string;
  display_phone?: string;
  phone?: string;
  location?: { display_address?: string[] };
  categories?: { title: string }[];
};

async function searchYelpForEstado(estado: string, cantidad: number): Promise<CompanyCandidate[]> {
  const apiKey = process.env.YELP_API_KEY;
  const location = CIUDAD_POR_ESTADO[estado] ?? `${estado}, USA`;
  const limit = Math.max(1, Math.min(YELP_MAX_POR_LLAMADA, cantidad));

  const url = `https://api.yelp.com/v3/businesses/search?location=${encodeURIComponent(
    location
  )}&categories=${CATEGORIAS}&limit=${limit}`;

  const { status, text } = await getJson(url, { Authorization: `Bearer ${apiKey}` });

  if (status < 200 || status >= 300) {
    throw new Error(`Yelp API error ${status}: ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  const businesses: YelpBusiness[] = data.businesses ?? [];

  return businesses.map((b) => ({
    company: b.name,
    state: estado,
    website: "",
    email: "",
    phone: b.display_phone || b.phone || "",
    social_media: "",
    category: (b.categories ?? []).map((c) => c.title).join(", "),
    source: b.url ?? "https://www.yelp.com",
    address: (b.location?.display_address ?? []).join(", "),
  }));
}

export async function searchYelpClients(
  estados: string[],
  cantidadTotal: number
): Promise<CompanyCandidate[]> {
  const porEstado = Math.max(1, Math.ceil(cantidadTotal / estados.length));
  const resultados: CompanyCandidate[] = [];

  for (const estado of estados) {
    try {
      const encontrados = await searchYelpForEstado(estado, porEstado);
      resultados.push(...encontrados);
    } catch {
      // Yelp es un complemento; si falla para un estado, seguimos con los demás.
    }
  }

  return resultados;
}
