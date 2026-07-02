import { google, sheets_v4 } from "googleapis";

/**
 * Central place for all Google Sheets access. Everything else in the app
 * (dashboard, chat tools, research pipeline) should go through these
 * functions instead of touching googleapis directly.
 */

export const SHEET_TABS = {
  proveedores: "Proveedores",
  clientesPotenciales: "Clientes_Potenciales",
  logInvestigaciones: "Log_Investigaciones",
  reportes: "Reportes",
} as const;

export type SheetTabName = (typeof SHEET_TABS)[keyof typeof SHEET_TABS];

// Column headers per tab, in order. Row 1 of each tab must match this.
const TAB_HEADERS: Record<SheetTabName, string[]> = {
  [SHEET_TABS.proveedores]: [
    "id",
    "empresa",
    "estado",
    "sitio_web",
    "email",
    "telefono",
    "redes_sociales",
    "categoria",
    "fuente",
    "fecha_validacion",
    "ultima_actualizacion",
    "google_maps_url",
    "direccion",
  ],
  [SHEET_TABS.clientesPotenciales]: [
    "id",
    "empresa",
    "estado",
    "sitio_web",
    "email",
    "telefono",
    "redes_sociales",
    "categoria",
    "fuente",
    "fecha_validacion",
    "ultima_actualizacion",
    "google_maps_url",
    "direccion",
  ],
  [SHEET_TABS.logInvestigaciones]: [
    "fecha",
    "tipo", // automatica | manual
    "criterios",
    "nuevos",
    "actualizados",
    "estado_ejecucion", // ok | error
    "detalle",
  ],
  [SHEET_TABS.reportes]: ["fecha", "titulo", "url", "generado_por"],
};

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Revisa .env.local (ver .env.local.example).`
    );
  }
  return value;
}

let cachedClient: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const email = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  // Private keys stored in env vars usually have literal "\n" sequences
  // instead of real newlines; convert them back.
  const privateKey = getEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

export function getSpreadsheetId(): string {
  return getEnv("GOOGLE_SHEET_ID");
}

/**
 * Ensures every tab in SHEET_TABS exists in the target spreadsheet with the
 * correct header row. Safe to call repeatedly (e.g. at pipeline start).
 * Returns which tabs were created, for logging/debugging.
 */
export async function ensureSheetsReady(): Promise<{ created: string[]; existing: string[] }> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[]
  );

  const created: string[] = [];
  const existing: string[] = [];
  const requests: sheets_v4.Schema$Request[] = [];

  for (const tabName of Object.values(SHEET_TABS)) {
    if (existingTitles.has(tabName)) {
      existing.push(tabName);
    } else {
      created.push(tabName);
      requests.push({ addSheet: { properties: { title: tabName } } });
    }
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  // Write/confirm header row for every tab (cheap, idempotent).
  for (const tabName of Object.values(SHEET_TABS)) {
    const headers = TAB_HEADERS[tabName];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1:${columnLetter(headers.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  return { created, existing };
}

/** Reads all rows of a tab as plain objects keyed by header name. */
export async function getRows(tabName: SheetTabName): Promise<Record<string, string>[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const headers = TAB_HEADERS[tabName];

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A2:${columnLetter(headers.length)}`,
  });

  const rows = res.data.values ?? [];
  return rows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = row[i] ?? "";
    });
    return record;
  });
}

/** Like getRows, but also returns the 1-based row number in the sheet (for updates). */
export async function getRowsWithSheetIndex(
  tabName: SheetTabName
): Promise<{ row: Record<string, string>; sheetRow: number }[]> {
  const rows = await getRows(tabName);
  // Row 1 is the header, so data starts at row 2.
  return rows.map((row, i) => ({ row, sheetRow: i + 2 }));
}

/** Appends a single row to a tab. `record` keys must match TAB_HEADERS for that tab. */
export async function appendRow(
  tabName: SheetTabName,
  record: Record<string, string>
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const headers = TAB_HEADERS[tabName];
  const values = [headers.map((h) => record[h] ?? "")];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/** Overwrites an existing row (1-based sheet row number, as returned by getRowsWithSheetIndex). */
export async function updateRow(
  tabName: SheetTabName,
  sheetRow: number,
  record: Record<string, string>
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const headers = TAB_HEADERS[tabName];
  const values = [headers.map((h) => record[h] ?? "")];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${sheetRow}:${columnLetter(headers.length)}${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

/** Igual que appendRow pero para muchas filas a la vez (una sola llamada HTTP). */
export async function appendRows(
  tabName: SheetTabName,
  records: Record<string, string>[]
): Promise<void> {
  if (records.length === 0) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const headers = TAB_HEADERS[tabName];
  const values = records.map((record) => headers.map((h) => record[h] ?? ""));

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/**
 * Igual que updateRow pero para muchas filas a la vez (una sola llamada
 * HTTP vía spreadsheets.values.batchUpdate, NO spreadsheets.batchUpdate —
 * ese es para cambios estructurales como crear pestañas, ver
 * ensureSheetsReady).
 */
export async function batchUpdateRows(
  tabName: SheetTabName,
  updates: { sheetRow: number; record: Record<string, string> }[]
): Promise<void> {
  if (updates.length === 0) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const headers = TAB_HEADERS[tabName];

  const data: sheets_v4.Schema$ValueRange[] = updates.map(({ sheetRow, record }) => ({
    range: `${tabName}!A${sheetRow}:${columnLetter(headers.length)}${sheetRow}`,
    values: [headers.map((h) => record[h] ?? "")],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

function columnLetter(count: number): string {
  let letter = "";
  let n = count;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}
