import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "@/lib/research";
import { postJson, sleep, parseRetryAfterMs } from "@/lib/http";
import {
  CHAT_TOOLS_DESCRIPTION,
  CONSULTAR_EMPRESAS_TOOL_NAME,
  consultarEmpresasSchema,
  BUSCAR_NUEVAS_EMPRESAS_TOOL_NAME,
  BUSCAR_NUEVAS_EMPRESAS_DESCRIPTION,
  buscarNuevasEmpresasSchema,
  executeTool,
} from "@/lib/chat-tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `Eres el asistente de inteligencia comercial de una empresa que vende artículos deportivos en Texas, Florida y California (EE.UU.).

Tienes dos herramientas:
- "${CONSULTAR_EMPRESAS_TOOL_NAME}": consulta (solo lectura) los proveedores/clientes ya guardados. Úsala para responder preguntas sobre lo que ya existe.
- "${BUSCAR_NUEVAS_EMPRESAS_TOOL_NAME}": dispara una búsqueda real en la web (puede tardar hasta un minuto) y guarda lo que encuentre. Úsala solo cuando el usuario pida explícitamente buscar/investigar empresas nuevas.

Reglas importantes:
- Nunca inventes nombres de empresas, sitios web, emails o teléfonos que no vengan de una herramienta.
- Si una herramienta no encuentra nada, dilo claramente en vez de inventar.
- Si el usuario pide algo que ninguna herramienta puede hacer, dilo directamente en un mensaje de texto — no llames herramientas en un loop tratando de adivinar cómo cumplir el pedido.
- No llames la misma herramienta más de 2 veces seguidas con argumentos parecidos; si no funciona, explica el problema en texto.
- Los datos guardados (nombre de empresa, categoría, dirección, etc.) están en inglés — puedes leerlos y citarlos tal cual, sin traducirlos.
- El usuario puede escribirte en español o en inglés indistintamente; entiende ambos igual de bien.
- Responde SIEMPRE en español, de forma clara y concisa, sin importar en qué idioma te haya escrito el usuario.`;

const MAX_TOOL_ITERATIONS = 6;

type GroqMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

async function chatWithGroq(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile";

  const groqMessages: GroqMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  const tools = [
    {
      type: "function",
      function: {
        name: CONSULTAR_EMPRESAS_TOOL_NAME,
        description: CHAT_TOOLS_DESCRIPTION,
        parameters: consultarEmpresasSchema,
      },
    },
    {
      type: "function",
      function: {
        name: BUSCAR_NUEVAS_EMPRESAS_TOOL_NAME,
        description: BUSCAR_NUEVAS_EMPRESAS_DESCRIPTION,
        parameters: buscarNuevasEmpresasSchema,
      },
    },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const body = { model, messages: groqMessages, tools, temperature: 0.3 };

    let status = 0;
    let text = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await postJson("https://api.groq.com/openai/v1/chat/completions", body, {
        Authorization: `Bearer ${apiKey}`,
      });
      status = res.status;
      text = res.text;
      if (status === 429 && attempt === 0) {
        await sleep(parseRetryAfterMs(text, 8000));
        continue;
      }
      break;
    }

    if (status < 200 || status >= 300) {
      throw new Error(`Groq API error ${status}: ${text.slice(0, 500)}`);
    }

    const data = JSON.parse(text);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Groq no devolvió una respuesta reconocible.");

    if (message.tool_calls?.length) {
      groqMessages.push({ role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls });
      for (const toolCall of message.tool_calls) {
        let args: unknown = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await executeTool(toolCall.function.name, args);
        groqMessages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
      }
      continue;
    }

    return message.content ?? "";
  }

  throw new Error("Se alcanzó el máximo de pasos de herramientas sin una respuesta final.");
}

async function chatWithAnthropic(messages: ChatMessage[]): Promise<string> {
  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const tools: Anthropic.Tool[] = [
    {
      name: CONSULTAR_EMPRESAS_TOOL_NAME,
      description: CHAT_TOOLS_DESCRIPTION,
      input_schema: consultarEmpresasSchema,
    },
    {
      name: BUSCAR_NUEVAS_EMPRESAS_TOOL_NAME,
      description: BUSCAR_NUEVAS_EMPRESAS_DESCRIPTION,
      input_schema: buscarNuevasEmpresasSchema,
    },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools,
      messages: anthropicMessages,
    });

    if (response.stop_reason === "tool_use") {
      anthropicMessages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const result = await executeTool(block.name, block.input);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }
      }
      anthropicMessages.push({ role: "user", content: toolResults });
      continue;
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return textBlock?.text ?? "";
  }

  throw new Error("Se alcanzó el máximo de pasos de herramientas sin una respuesta final.");
}

export async function getChatReply(messages: ChatMessage[]): Promise<string> {
  if (process.env.GROQ_API_KEY) return chatWithGroq(messages);
  if (process.env.ANTHROPIC_API_KEY) return chatWithAnthropic(messages);
  throw new Error("Falta GROQ_API_KEY o ANTHROPIC_API_KEY en .env.local para usar el chat.");
}
