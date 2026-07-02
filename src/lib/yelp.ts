import { getJson } from "@/lib/http";
import type { CompanyCandidate } from "@/lib/validation";

/**
 * Complementa la búsqueda de clientes potenciales (enfocada solo a
 * béisbol: academias, ligas/torneos, canchas) con datos reales de Yelp:
 * dirección exacta y teléfono verificado, cosa que la búsqueda con IA no
 * siempre consigue. Solo aplica a "clientes", no a proveedores/mayoristas
 * (Yelp es un directorio de consumo, no B2B).
 *
 * La API de búsqueda de Yelp centra la búsqueda en un punto + radio (no
 * permite buscar "todo el estado" de una vez), así que se aproxima
 * cubriendo varias ciudades grandes por estado como anclas — una sola
 * ciudad (ej. solo Houston para TX) agota rápido los negocios que hay en
 * ese radio, y correr la búsqueda de nuevo solo vuelve a encontrar los
 * mismos negocios ya guardados en vez de aportar nuevos.
 */
const CIUDADES_POR_ESTADO: Record<string, string[]> = {
  TX: ["Houston, TX", "Dallas, TX", "Austin, TX", "San Antonio, TX", "Fort Worth, TX", "El Paso, TX"],
  FL: ["Miami, FL", "Orlando, FL", "Tampa, FL", "Jacksonville, FL", "Fort Lauderdale, FL"],
  CA: ["Los Angeles, CA", "San Diego, CA", "San Francisco, CA", "Sacramento, CA", "San Jose, CA"],
};

// Categorías amplias (deporte/entrenamiento/complejos) + "battingcages"
// (Batting Cages, categoría oficial de Yelp) para cubrir instalaciones de
// bateo. El filtro real de "solo béisbol" lo hace TERM_BUSQUEDA abajo
// (Yelp permite combinar categories + term en la misma búsqueda).
const CATEGORIAS = "sportgoods,gyms,sportsclubs,trainers,leisure_centers,battingcages";
const TERM_BUSQUEDA = "baseball";
const YELP_MAX_POR_LLAMADA = 10;

type YelpBusiness = {
  name: string;
  url?: string;
  display_phone?: string;
  phone?: string;
  location?: { display_address?: string[] };
  categories?: { title: string }[];
};

async function searchYelpForLocation(
  estado: string,
  location: string,
  cantidad: number
): Promise<CompanyCandidate[]> {
  const apiKey = process.env.YELP_API_KEY;
  const limit = Math.max(1, Math.min(YELP_MAX_POR_LLAMADA, cantidad));

  const url = `https://api.yelp.com/v3/businesses/search?location=${encodeURIComponent(
    location
  )}&categories=${CATEGORIAS}&term=${encodeURIComponent(TERM_BUSQUEDA)}&limit=${limit}`;

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
    const ciudades = CIUDADES_POR_ESTADO[estado] ?? [`${estado}, USA`];
    const porCiudad = Math.max(1, Math.ceil(porEstado / ciudades.length));

    for (const ciudad of ciudades) {
      try {
        const encontrados = await searchYelpForLocation(estado, ciudad, porCiudad);
        resultados.push(...encontrados);
      } catch {
        // Yelp es un complemento; si falla para una ciudad, seguimos con las demás.
      }
    }
  }

  return resultados;
}
