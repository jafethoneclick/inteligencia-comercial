import { NextResponse } from "next/server";
import { SHEET_TABS, appendRow, ensureSheetsReady, getRows } from "@/lib/google-sheets";
import { generateReportPdf, type ReportSection } from "@/lib/reports";

type RequestBody = {
  tipo: "proveedores" | "clientes" | "ambos";
  estados?: string[];
};

const TITULOS: Record<"proveedores" | "clientes", string> = {
  proveedores: "Proveedores",
  clientes: "Clientes Potenciales",
};

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido, se espera JSON." }, { status: 400 });
  }

  if (!["proveedores", "clientes", "ambos"].includes(body.tipo)) {
    return NextResponse.json(
      { ok: false, error: 'tipo debe ser "proveedores", "clientes" o "ambos"' },
      { status: 400 }
    );
  }

  const estadosFiltro = body.estados?.length ? body.estados.map((e) => e.toUpperCase()) : null;
  const tiposAIncluir: ("proveedores" | "clientes")[] =
    body.tipo === "ambos" ? ["proveedores", "clientes"] : [body.tipo];

  try {
    await ensureSheetsReady();

    const secciones: ReportSection[] = [];
    for (const tipo of tiposAIncluir) {
      const tab = tipo === "proveedores" ? SHEET_TABS.proveedores : SHEET_TABS.clientesPotenciales;
      const filas = await getRows(tab);
      const filtradas = estadosFiltro
        ? filas.filter((f) => estadosFiltro.includes((f.state || "").toUpperCase()))
        : filas;
      secciones.push({ titulo: TITULOS[tipo], filas: filtradas });
    }

    const subtitulo = `${
      body.tipo === "ambos" ? "Proveedores y clientes potenciales" : TITULOS[body.tipo as "proveedores" | "clientes"]
    } · ${estadosFiltro ? estadosFiltro.join(", ") : "TX, FL, CA"}`;

    const pdfBuffer = await generateReportPdf({
      titulo: "Inteligencia Comercial — Artículos Deportivos",
      subtitulo,
      secciones,
    });

    const ahora = new Date();
    const titulo = `Reporte ${subtitulo} — ${ahora.toLocaleDateString("es-US")}`;

    await appendRow(SHEET_TABS.reportes, {
      date: ahora.toISOString(),
      title: titulo,
      url: "",
      generated_by: "dashboard",
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="reporte-${ahora.toISOString().slice(0, 10)}.pdf"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
