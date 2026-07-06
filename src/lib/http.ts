import https from "node:https";

/**
 * POST JSON usando node:https directamente en vez de fetch(). El fetch
 * global de Next.js está parcheado para su caché de datos y manda el body
 * con "chunked encoding" sin Content-Length; algunos proxies (ej. el de
 * Groq) lo rechazan con un 413 "Request Entity Too Large" falso incluso
 * para bodies pequeños. https.request nos da control total sobre los
 * headers y evita ese problema.
 */
export function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const bodyBuffer = Buffer.from(JSON.stringify(body), "utf8");
    const { hostname, pathname, search } = new URL(url);

    const req = https.request(
      {
        hostname,
        path: pathname + search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": bodyBuffer.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );

    req.on("error", reject);
    req.write(bodyBuffer);
    req.end();
  });
}

/**
 * GET usando node:https, por la misma razón que postJson (ver arriba).
 *
 * `timeoutMs` es opcional pero importante para servidores públicos poco
 * confiables (ej. mirrors de Overpass): sin él, node:https espera
 * indefinidamente a un servidor que acepta la conexión pero nunca
 * responde, y eso deja colgada toda la corrida del pipeline.
 */
export function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs?: number
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search } = new URL(url);

    const req = https.request(
      { hostname, path: pathname + search, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );

    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout de ${timeoutMs}ms esperando a ${hostname}`));
      });
    }

    req.on("error", reject);
    req.end();
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Si el error trae "Please try again in 5.19s", devuelve ~6190ms; si no, un default. */
export function parseRetryAfterMs(errorText: string, fallbackMs: number): number {
  const match = errorText.match(/try again in ([\d.]+)s/i);
  if (!match) return fallbackMs;
  return Math.ceil(parseFloat(match[1]) * 1000) + 1000;
}
