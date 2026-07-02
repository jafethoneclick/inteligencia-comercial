import { SHEET_TABS, getRows } from "@/lib/google-sheets";
import { runResearchPipeline } from "@/lib/pipeline";

/**
 * Herramienta que el chat puede invocar para consultar los datos ya
 * guardados en Google Sheets (Proveedores / Clientes_Potenciales). No
 * busca en la web ni modifica nada, solo lee y filtra lo que ya existe.
 */
export const CONSULTAR_EMPRESAS_TOOL_NAME = "consultar_empresas";

export const consultarEmpresasSchema = {
  type: "object" as const,
  properties: {
    tipo: {
      type: "string",
      enum: ["proveedores", "clientes"],
      description:
        "Qué tabla consultar: proveedores (artículos deportivos en general) o clientes potenciales (enfocado solo a béisbol: academias, ligas, torneos, canchas).",
    },
    estado: {
      type: "string",
      enum: ["TX", "FL", "CA"],
      description: "Filtrar por estado (opcional). Si no se da, incluye los 3.",
    },
    texto: {
      type: "string",
      description:
        "Texto libre para buscar en nombre, categoría, email, sitio web, etc (opcional).",
    },
  },
  required: ["tipo"],
};

export const CHAT_TOOLS_DESCRIPTION =
  "Busca proveedores de artículos deportivos en general, o clientes potenciales (enfocado solo a béisbol: academias, ligas, torneos, canchas) ya guardados en la base de datos (Google Sheets), con filtros opcionales por estado y texto libre.";

type ConsultarEmpresasArgs = {
  tipo: "proveedores" | "clientes";
  estado?: string;
  texto?: string;
};

const MAX_RESULTADOS = 20;

export async function consultarEmpresas(args: ConsultarEmpresasArgs): Promise<string> {
  const tab = args.tipo === "proveedores" ? SHEET_TABS.proveedores : SHEET_TABS.clientesPotenciales;
  const rows = await getRows(tab);

  let filtradas = rows;
  if (args.estado) {
    const estado = args.estado.toUpperCase();
    filtradas = filtradas.filter((r) => (r.state || "").toUpperCase() === estado);
  }
  if (args.texto) {
    // Coincide si CUALQUIER palabra del texto aparece en algún campo (no la
    // frase completa) — el modelo a veces manda varios nombres de empresa
    // juntos en un solo "texto", y exigir el match exacto de todo el string
    // nunca encontraba nada.
    const palabras = args.texto.toLowerCase().split(/\s+/).filter(Boolean);
    filtradas = filtradas.filter((r) =>
      Object.values(r).some((v) => {
        const valor = v.toLowerCase();
        return palabras.some((p) => valor.includes(p));
      })
    );
  }

  const total = filtradas.length;
  const empresas = filtradas.slice(0, MAX_RESULTADOS).map((r) => ({
    company: r.company,
    state: r.state,
    website: r.website,
    email: r.email,
    phone: r.phone,
    category: r.category,
    social_media: r.social_media,
    google_maps_url: r.google_maps_url,
    updated_at: r.updated_at,
  }));

  return JSON.stringify({
    total_encontrado: total,
    mostrando: empresas.length,
    empresas,
  });
}

/**
 * Herramienta que el chat puede invocar para disparar una búsqueda nueva
 * (con IA, y Yelp para clientes), validar los resultados, evitar
 * duplicados, y guardarlos en Sheets — el mismo pipeline que usa el botón
 * "Buscar ahora" del dashboard. Esta sí escribe datos, a diferencia de
 * consultar_empresas.
 */
export const BUSCAR_NUEVAS_EMPRESAS_TOOL_NAME = "buscar_nuevas_empresas";

export const buscarNuevasEmpresasSchema = {
  type: "object" as const,
  properties: {
    tipo: {
      type: "string",
      enum: ["proveedores", "clientes"],
      description:
        "Qué tipo de empresa buscar: proveedores (artículos deportivos en general) o clientes potenciales (solo béisbol: academias, ligas, torneos, canchas).",
    },
    estados: {
      type: "array",
      items: { type: "string", enum: ["TX", "FL", "CA"] },
      description: "Estados donde buscar (opcional). Si no se da, busca en los 3.",
    },
    cantidad: {
      type: "number",
      description: "Cuántas empresas buscar por estado (opcional, por defecto 4).",
    },
    criterios: {
      type: "string",
      description: 'Criterio adicional opcional, ej. "fabricantes de balones de fútbol".',
    },
  },
  required: ["tipo"],
};

export const BUSCAR_NUEVAS_EMPRESAS_DESCRIPTION =
  "Dispara una búsqueda nueva de proveedores o clientes potenciales en la web (y Yelp para clientes), valida los resultados y los guarda en Google Sheets evitando duplicados. Úsala solo cuando el usuario pida explícitamente buscar/investigar empresas nuevas, no para consultar lo que ya existe (para eso usa consultar_empresas).";

type BuscarNuevasEmpresasArgs = {
  tipo: "proveedores" | "clientes";
  estados?: string[];
  cantidad?: number;
  criterios?: string;
};

const DEFAULT_ESTADOS = ["TX", "FL", "CA"];

export async function buscarNuevasEmpresas(args: BuscarNuevasEmpresasArgs): Promise<string> {
  const estados = args.estados?.length ? args.estados : DEFAULT_ESTADOS;
  try {
    const resultado = await runResearchPipeline(
      {
        tipo: args.tipo,
        estados,
        // Clamp de seguridad: si el modelo pasa un valor absurdo por error
        // en el tool-call, no debe traducirse en una corrida descontrolada.
        cantidad: Math.min(args.cantidad ?? 4, 1200),
        criterios: args.criterios,
      },
      "manual"
    );
    return JSON.stringify(resultado);
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
}

export async function executeTool(name: string, args: unknown): Promise<string> {
  if (name === CONSULTAR_EMPRESAS_TOOL_NAME) {
    return consultarEmpresas(args as ConsultarEmpresasArgs);
  }
  if (name === BUSCAR_NUEVAS_EMPRESAS_TOOL_NAME) {
    return buscarNuevasEmpresas(args as BuscarNuevasEmpresasArgs);
  }
  return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
}
