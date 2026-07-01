/**
 * Validación de la información pública encontrada para una empresa antes de
 * guardarla en Sheets. No garantiza que el negocio sea legítimo, solo que los
 * datos tienen forma correcta y las URLs/dominios realmente responden.
 */

export type CompanyCandidate = {
  empresa: string;
  estado: string;
  sitio_web: string;
  email: string;
  telefono: string;
  redes_sociales: string; // URLs separadas por coma
  categoria: string;
  fuente: string;
  direccion?: string; // dirección física completa, cuando se conoce (ej. vía Yelp)
};

export type ValidationResult = {
  valid: boolean;
  issues: string[];
  checkedAt: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const US_PHONE_REGEX = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
const KNOWN_SOCIAL_DOMAINS = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com"];

export async function validateCandidate(candidate: CompanyCandidate): Promise<ValidationResult> {
  const issues: string[] = [];

  if (!candidate.empresa?.trim()) {
    issues.push("Falta el nombre de la empresa");
  }

  if (!candidate.estado || !["TX", "FL", "CA"].includes(candidate.estado.toUpperCase())) {
    issues.push(`Estado fuera de alcance: "${candidate.estado}"`);
  }

  if (candidate.sitio_web) {
    const domainOk = await isDomainReachable(candidate.sitio_web);
    if (!domainOk) issues.push(`El sitio web no responde: ${candidate.sitio_web}`);
  } else if (!candidate.direccion?.trim()) {
    // Sin sitio web, aceptamos el candidato si al menos hay una dirección
    // física verificable (ej. proveniente de Yelp), que ya es evidencia de
    // que el negocio existe.
    issues.push("Falta sitio web y dirección");
  }

  if (candidate.email && !EMAIL_REGEX.test(candidate.email)) {
    issues.push(`Email con formato inválido: ${candidate.email}`);
  }

  if (candidate.telefono && !US_PHONE_REGEX.test(candidate.telefono)) {
    issues.push(`Teléfono con formato inválido: ${candidate.telefono}`);
  }

  if (candidate.redes_sociales) {
    const urls = candidate.redes_sociales.split(",").map((u) => u.trim()).filter(Boolean);
    for (const url of urls) {
      if (!KNOWN_SOCIAL_DOMAINS.some((domain) => url.includes(domain))) {
        issues.push(`Red social no reconocida como oficial: ${url}`);
      }
    }
  }

  return { valid: issues.length === 0, issues, checkedAt: new Date().toISOString() };
}

// Muchos sitios grandes (Academy, Gold's Gym, Big 5, etc.) están detrás de
// Cloudflare/Akamai y bloquean requests sin apariencia de navegador real,
// devolviendo 403/503 a un fetch de servidor sin marcarlo como "caído". Por
// eso mandamos un User-Agent de navegador, y consideramos "reachable"
// cualquier respuesta HTTP recibida (el dominio existe y el servidor
// contestó) — solo se descarta si la conexión falla de verdad (DNS, timeout,
// conexión rechazada), no por el código de estado que devuelva.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

async function isDomainReachable(url: string): Promise<boolean> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    await fetch(target, {
      method: "HEAD",
      redirect: "follow",
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return true;
  } catch {
    // Algunos sitios bloquean HEAD directamente; probamos GET como respaldo.
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      await fetch(target, {
        method: "GET",
        redirect: "follow",
        headers: BROWSER_HEADERS,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return true;
    } catch {
      return false;
    }
  }
}
