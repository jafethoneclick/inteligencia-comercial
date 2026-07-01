import { NextResponse } from "next/server";
import { ensureSheetsReady, getSpreadsheetId } from "@/lib/google-sheets";

/**
 * Visit /api/sheets/test to verify the Google Sheets connection.
 * It creates any missing tabs (Proveedores, Clientes_Potenciales,
 * Log_Investigaciones, Reportes) with the correct headers and reports status.
 */
export async function GET() {
  try {
    const { created, existing } = await ensureSheetsReady();
    return NextResponse.json({
      ok: true,
      spreadsheetId: getSpreadsheetId(),
      tabsCreated: created,
      tabsAlreadyExisting: existing,
      message: "Conexión con Google Sheets exitosa.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}
