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
  empresa: z.string().min(1),
  estado: z.string().min(2),
  sitio_web: z.string().default(""),
  email: z.string().default(""),
  telefono: z.string().default(""),
  redes_sociales: z.string().default(""),
  categoria: z.string().default(""),
  fuente: z.string().default(""),
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

  const objetivo =
    tipo === "proveedores"
      ? "proveedores/fabricantes/mayoristas de artículos deportivos"
      : "clientes potenciales que podrían comprar artículos deportivos al por mayor (tiendas deportivas, gimnasios, clubes, escuelas)";

  return `Eres un asistente de inteligencia comercial. Busca en la web ${cantidad} empresas reales de ${objetivo}, ubicadas en: ${estados.join(", ")} (Estados Unidos).
${criterios ? `Criterio adicional del usuario: ${criterios}` : ""}

Para cada empresa, visita su sitio web oficial y extrae solo información pública verificable: nombre, estado (código de 2 letras: TX, FL o CA), sitio web oficial, email de contacto público (si existe), teléfono público (si existe), URLs de redes sociales oficiales (LinkedIn/Facebook/Instagram, verificadas contra el dominio oficial), categoría/rubro específico, y la URL fuente donde confirmaste la información.

No inventes datos. Si no encuentras un campo, déjalo como cadena vacía "".

Responde ÚNICAMENTE con un array JSON válido (sin texto antes ni después, sin bloques de markdown), con este formato exacto por cada empresa:
[{"empresa": "", "estado": "", "sitio_web": "", "email": "", "telefono": "", "redes_sociales": "", "categoria": "", "fuente": ""}]`;
}

/**
 * Extrae los objetos JSON completos de nivel superior de un texto (que puede
 * estar truncado, sin "]" de cierre). Cuenta llaves respetando si está
 * dentro de un string (para no confundirse con "{"/"}" dentro de valores,
 * ej. redes_sociales a veces viene como un objeto anidado). Se usa como
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
