/**
 * Genera un link de búsqueda de Google Maps para una empresa. No requiere
 * API key ni cuenta de Google Cloud: es la URL pública de búsqueda de Maps
 * (https://www.google.com/maps/search/?api=1&query=...), que Google resuelve
 * del lado del navegador al abrir el link.
 */
export function buildGoogleMapsUrl(empresa: string, estado: string, direccion?: string): string {
  // Si hay dirección física real (ej. de Yelp), buscar por dirección da un
  // pin mucho más preciso que buscar solo por nombre + estado.
  const query = direccion?.trim() ? `${empresa}, ${direccion}` : `${empresa}, ${estado}, USA`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
