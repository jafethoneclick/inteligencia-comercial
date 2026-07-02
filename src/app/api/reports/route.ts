import { NextResponse } from "next/server";
import { SHEET_TABS, appendRow, ensureSheetsReady, getRows } from "@/lib/google-sheets";
import { generateReportPdf, type ReportSection } from "@/lib/reports";

type RequestBody = {
  tipo: "proveedores" | "clientes" | "ambos";
  estados?: string[];
};

const TITULOS: Record<"proveedores" | "clientes", string> = {
  proveedores: "Suppliers",
  clientes: "Potential Customers",
};

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body, JSON expected." }, { status: 400 });
  }

  if (!["proveedores", "clientes", "ambos"].includes(body.tipo)) {
    return NextResponse.json(
      { ok: false, error: 'tipo must be "proveedores", "clientes", or "ambos"' },
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
      body.tipo === "ambos" ? "Suppliers and potential customers" : TITULOS[body.tipo as "proveedores" | "clientes"]
    } · ${estadosFiltro ? estadosFiltro.join(", ") : "TX, FL, CA"}`;

    const pdfBuffer = await generateReportPdf({
      titulo: "Commercial Intelligence — Sporting Goods",
      subtitulo,
      secciones,
    });

    const ahora = new Date();
    const titulo = `Report ${subtitulo} — ${ahora.toLocaleDateString("en-US")}`;

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
        "Content-Disposition": `attachment; filename="report-${ahora.toISOString().slice(0, 10)}.pdf"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
