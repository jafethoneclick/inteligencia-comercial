import { NextResponse, type NextRequest } from "next/server";

/**
 * Protege el dashboard y las rutas API (excepto el cron, que ya tiene su
 * propia protección con CRON_SECRET) con un login compartido simple, para
 * que el sitio en producción no quede abierto a cualquiera con la URL.
 */
export function proxy(request: NextRequest) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;

  // Si no se configuraron las credenciales, no se bloquea nada (evita
  // dejar el dashboard inaccesible por accidente si alguien olvida
  // definir las variables en desarrollo).
  if (!user || !password) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Basic ")) {
    const encoded = authHeader.slice("Basic ".length);
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    const providedUser = decoded.slice(0, separatorIndex);
    const providedPassword = decoded.slice(separatorIndex + 1);

    if (providedUser === user && providedPassword === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Autenticación requerida.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Inteligencia Comercial"' },
  });
}

export const config = {
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico).*)"],
};
