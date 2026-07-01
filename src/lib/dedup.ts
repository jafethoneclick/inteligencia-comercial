/**
 * Deduplicación en memoria: compara un candidato nuevo contra las filas ya
 * existentes de una pestaña de Sheets (cargadas previamente con getRows),
 * sin necesidad de una base de datos.
 */

export type ExistingRow = Record<string, string>;

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/\b(inc|llc|corp|co|ltd|company)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^www\./, "");
  }
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^1/, "");
}

/**
 * Devuelve la fila existente que coincide con el candidato (por dominio,
 * teléfono o nombre normalizado), o null si no hay coincidencia.
 */
export function findDuplicate(
  candidate: { empresa: string; sitio_web?: string; telefono?: string },
  existingRows: ExistingRow[]
): ExistingRow | null {
  const candidateDomain = extractDomain(candidate.sitio_web ?? "");
  const candidatePhone = normalizePhone(candidate.telefono ?? "");
  const candidateName = normalizeCompanyName(candidate.empresa);

  for (const row of existingRows) {
    const rowDomain = extractDomain(row.sitio_web ?? "");
    if (candidateDomain && rowDomain && candidateDomain === rowDomain) return row;

    const rowPhone = normalizePhone(row.telefono ?? "");
    if (candidatePhone && rowPhone && candidatePhone === rowPhone) return row;

    const rowName = normalizeCompanyName(row.empresa ?? "");
    if (candidateName && rowName && candidateName === rowName) return row;
  }

  return null;
}
