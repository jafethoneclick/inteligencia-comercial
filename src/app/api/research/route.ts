import { NextResponse } from "next/server";
import { runResearchPipeline } from "@/lib/pipeline";
import type { ResearchParams } from "@/lib/research";

export const maxDuration = 300; // el pipeline hace varias búsquedas web, puede tardar

type RequestBody = {
  tipo: "proveedores" | "clientes";
  estados?: string[];
  criterios?: string;
  cantidad?: number;
};

const DEFAULT_ESTADOS = ["TX", "FL", "CA"];

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body, JSON expected." }, { status: 400 });
  }

  if (body.tipo !== "proveedores" && body.tipo !== "clientes") {
    return NextResponse.json(
      { ok: false, error: 'tipo must be "proveedores" or "clientes"' },
      { status: 400 }
    );
  }

  const params: ResearchParams = {
    tipo: body.tipo,
    estados: body.estados?.length ? body.estados : DEFAULT_ESTADOS,
    criterios: body.criterios,
    cantidad: body.cantidad ?? 8,
  };

  try {
    const result = await runResearchPipeline(params, "manual");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
