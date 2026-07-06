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
// TX tiene una lista mucho más larga a propósito — es el mercado principal
// del negocio, y Yelp es gratis hasta 500 llamadas/día, así que no hay
// motivo para ser conservador aquí (25 ciudades por corrida de "clientes"
// caben sin problema en esa cuota).
const CIUDADES_POR_ESTADO: Record<string, string[]> = {
  TX: [
    "Houston, TX", "San Antonio, TX", "Dallas, TX", "Austin, TX", "Fort Worth, TX",
    "El Paso, TX", "Arlington, TX", "Corpus Christi, TX", "Plano, TX", "Laredo, TX",
    "Lubbock, TX", "Garland, TX", "Irving, TX", "Amarillo, TX", "Grand Prairie, TX",
    "Brownsville, TX", "McKinney, TX", "Frisco, TX", "Pasadena, TX", "Killeen, TX",
    "McAllen, TX", "Mesquite, TX", "Midland, TX", "Waco, TX", "Denton, TX",
  ],
  FL: ["Miami, FL", "Orlando, FL", "Tampa, FL", "Jacksonville, FL", "Fort Lauderdale, FL"],
  CA: ["Los Angeles, CA", "San Diego, CA", "San Francisco, CA", "Sacramento, CA", "San Jose, CA"],
};

// Categorías amplias (deporte/entrenamiento/complejos) + "battingcages"
// (Batting Cages, categoría oficial de Yelp) para cubrir instalaciones de
// bateo. El filtro real de "solo béisbol" lo hace TERM_BUSQUEDA abajo
// (Yelp permite combinar categories + term en la misma búsqueda).
const CATEGORIAS = "sportgoods,gyms,sportsclubs,trainers,leisure_centers,battingcages";
const TERM_BUSQUEDA = "baseball";

// Ventana fija por ciudad, independiente de la `cantidad` pedida. Antes se
// pedían solo ceil(cantidad/ciudades) negocios por ciudad SIN offset, y Yelp
// devuelve siempre los mismos primeros N — tras la primera corrida todos
// estaban ya guardados y ninguna corrida volvía a aportar nuevos. Ahora se
// pagina con offset hasta agotar los resultados de la ciudad (o llegar al
// tope), y el deduplicador + el tope de nuevos del pipeline se encargan de
// que al Sheet solo entre lo que haga falta. Costo: máx 3 llamadas por
// ciudad → 35 ciudades ≈ 105 llamadas por corrida, holgado dentro de la
// cuota gratuita de 500/día.
const YELP_LIMIT_POR_LLAMADA = 50; // máximo que acepta la API por llamada
const YELP_MAX_POR_CIUDAD = 150;

type YelpBusiness = {
  name: string;
  url?: string;
  display_phone?: string;
  phone?: string;
  location?: { display_address?: string[] };
  categories?: { title: string }[];
};

async function searchYelpForLocation(estado: string, location: string): Promise<CompanyCandidate[]> {
  const apiKey = process.env.YELP_API_KEY;
  const businesses: YelpBusiness[] = [];

  for (let offset = 0; offset < YELP_MAX_POR_CIUDAD; offset += YELP_LIMIT_POR_LLAMADA) {
    const url = `https://api.yelp.com/v3/businesses/search?location=${encodeURIComponent(
      location
    )}&categories=${CATEGORIAS}&term=${encodeURIComponent(
      TERM_BUSQUEDA
    )}&limit=${YELP_LIMIT_POR_LLAMADA}&offset=${offset}`;

    const { status, text } = await getJson(url, { Authorization: `Bearer ${apiKey}` });

    if (status < 200 || status >= 300) {
      throw new Error(`Yelp API error ${status}: ${text.slice(0, 500)}`);
    }

    const data = JSON.parse(text);
    const page: YelpBusiness[] = data.businesses ?? [];
    businesses.push(...page);

    // Página incompleta = ya no hay más resultados en esta ciudad.
    if (page.length < YELP_LIMIT_POR_LLAMADA) break;
  }

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

export async function searchYelpClients(estados: string[]): Promise<CompanyCandidate[]> {
  const resultados: CompanyCandidate[] = [];

  for (const estado of estados) {
    const ciudades = CIUDADES_POR_ESTADO[estado] ?? [`${estado}, USA`];

    for (const ciudad of ciudades) {
      try {
        const encontrados = await searchYelpForLocation(estado, ciudad);
        resultados.push(...encontrados);
      } catch {
        // Yelp es un complemento; si falla para una ciudad, seguimos con las demás.
      }
    }
  }

  return resultados;
}
