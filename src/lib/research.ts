import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CompanyCandidate } from "@/lib/validation";
import { postJson, sleep, parseRetryAfterMs } from "@/lib/http";

export type ResearchParams = {
  tipo: "proveedores" | "clientes";
  estados: string[]; // ej. ["TX", "FL", "CA"]
  criterios?: string; // ej. "fabricantes de balones de fútbol"
  cantidad?: number; // cuántas empresas buscar en esta corrida
};

const candidateSchema = z.object({
  company: z.string().min(1),
  state: z.string().min(2),
  website: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  social_media: z.string().default(""),
  category: z.string().default(""),
  source: z.string().default(""),
});
/**
 * El pipeline soporta dos proveedores de IA con búsqueda web integrada:
 * Groq (modelos "compound", útil como key temporal/gratuita) y Anthropic
 * (Claude + web_search). Se elige automáticamente según qué API key esté
 * definida, así que cambiar de proveedor es solo cambiar variables de
 * entorno, sin tocar código.
 */
function buildPrompt(params: ResearchParams): string {
  const { tipo, estados, criterios, cantidad = 8 } = params;

  const target =
    tipo === "proveedores"
      ? "suppliers/manufacturers/wholesalers of sporting goods"
      : "potential customers specifically related to baseball who could buy baseball equipment in bulk (baseball academies, baseball/softball leagues and tournaments, Little League organizations, baseball fields/complexes, batting cages, baseball clubs and travel teams). Do NOT include businesses unrelated to baseball, even if they sell general sporting goods.";

  return `You are a commercial intelligence assistant. Search the web for ${cantidad} real companies that are ${target}, located in: ${estados.join(", ")} (United States).
${criterios ? `Additional user criteria: ${criterios}` : ""}

For each company, visit its official website and extract only verifiable public information: name, state (2-letter code: TX, FL, or CA), official website, public contact email (if any), public phone number (if any), official social media URLs (LinkedIn/Facebook/Instagram, verified against the official domain), specific category/industry, and the source URL where you confirmed the information.

Do not invent data. If a field can't be found, leave it as an empty string "".

Respond ONLY with all text content in English, and ONLY with a valid JSON array (no text before or after, no markdown code blocks), using this exact format per company:
[{"company": "", "state": "", "website": "", "email": "", "phone": "", "social_media": "", "category": "", "source": ""}]`;
}

/**
 * Extrae los objetos JSON completos de nivel superior de un texto (que puede
 * estar truncado, sin "]" de cierre). Cuenta llaves respetando si está
 * dentro de un string (para no confundirse con "{"/"}" dentro de valores,
 * ej. social_media a veces viene como un objeto anidado). Se usa como
 * respaldo cuando el modelo corta la respuesta a mitad del array.
 */
function extractTopLevelObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function parseCandidates(rawText: string, providerName: string): CompanyCandidate[] {
  const arrayStart = rawText.indexOf("[");
  if (arrayStart === -1) {
    throw new Error(
      `${providerName} no devolvió un JSON reconocible. Respuesta cruda: ${rawText.slice(0, 500)}`
    );
  }

  // Los modelos "compound" de Groq a veces cortan la respuesta a mitad del
  // array (por límite de tokens). En vez de descartar toda la corrida,
  // parseamos cada objeto de empresa por separado y nos quedamos con los
  // que sí están completos y válidos.
  const objects = extractTopLevelObjects(rawText.slice(arrayStart));
  const candidates: CompanyCandidate[] = [];

  for (const obj of objects) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(obj);
    } catch {
      continue;
    }
    const result = candidateSchema.safeParse(parsed);
    if (result.success) candidates.push(result.data);
  }

  if (candidates.length === 0) {
    throw new Error(
      `${providerName} no devolvió ninguna empresa válida. Respuesta cruda: ${rawText.slice(0, 500)}`
    );
  }

  return candidates;
}

let anthropicClient: Anthropic | null = null;
export function getAnthropicClient(): Anthropic {
  if (anthropicClient) return anthropicClient;
  anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

async function researchWithAnthropic(params: ResearchParams): Promise<CompanyCandidate[]> {
  const response = await getAnthropicClient().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    max_tokens: 8192,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 15 }],
    messages: [{ role: "user", content: buildPrompt(params) }],
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  const rawText = textBlocks.map((b) => b.text).join("\n").trim();

  return parseCandidates(rawText, "Claude");
}

const GROQ_MAX_POR_LLAMADA = 4; // más que esto y el modelo compound suele truncar la respuesta

async function researchWithGroqSingleCall(params: ResearchParams): Promise<CompanyCandidate[]> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "groq/compound";

  const requestBody = {
    model,
    messages: [{ role: "user", content: buildPrompt(params) }],
    temperature: 0.2,
    max_tokens: 8192,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { status, text } = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      requestBody,
      { Authorization: `Bearer ${apiKey}` }
    );

    if (status === 429 && attempt === 0) {
      await sleep(parseRetryAfterMs(text, 15000));
      continue;
    }

    if (status < 200 || status >= 300) {
      throw new Error(`Groq API error ${status}: ${text.slice(0, 500)}`);
    }

    const data = JSON.parse(text);
    const rawText: string = data.choices?.[0]?.message?.content ?? "";
    return parseCandidates(rawText, "Groq");
  }

  throw new Error("Groq siguió con rate limit tras reintentar.");
}

/**
 * Groq trunca la respuesta si se piden demasiadas empresas o demasiados
 * estados en una sola llamada (el modelo "compound" gasta parte del
 * presupuesto de tokens en su razonamiento interno). Para evitarlo, se
 * divide en una llamada por estado con un máximo chico de empresas por
 * llamada, y se juntan los resultados. Si alguna llamada individual falla,
 * no se pierde toda la corrida: se sigue con los demás estados.
 */
async function researchWithGroq(params: ResearchParams): Promise<CompanyCandidate[]> {
  const totalCantidad = params.cantidad ?? 8;
  const porEstado = Math.max(1, Math.min(GROQ_MAX_POR_LLAMADA, Math.ceil(totalCantidad / params.estados.length)));

  const candidates: CompanyCandidate[] = [];
  const errores: string[] = [];

  for (let i = 0; i < params.estados.length; i++) {
    const estado = params.estados[i];
    try {
      const resultado = await researchWithGroqSingleCall({
        ...params,
        estados: [estado],
        cantidad: porEstado,
      });
      candidates.push(...resultado);
    } catch (error) {
      errores.push(`${estado}: ${error instanceof Error ? error.message : "error desconocido"}`);
    }

    if (i < params.estados.length - 1) await sleep(3000);
  }

  if (candidates.length === 0) {
    throw new Error(`Groq falló para todos los estados solicitados. Detalle: ${errores.join(" | ")}`);
  }

  return candidates;
}

export async function researchCompanies(params: ResearchParams): Promise<CompanyCandidate[]> {
  if (process.env.GROQ_API_KEY) return researchWithGroq(params);
  if (process.env.ANTHROPIC_API_KEY) return researchWithAnthropic(params);
  throw new Error(
    "Falta GROQ_API_KEY o ANTHROPIC_API_KEY en .env.local. Necesaria para que el pipeline investigue empresas."
  );
}
