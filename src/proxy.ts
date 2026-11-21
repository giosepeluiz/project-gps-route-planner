import { NextResponse, type NextRequest } from "next/server";
import { apiLimitPerMinute, createRateLimiter } from "@/lib/server/rate-limit";

/**
 * Roda antes de cada requisição às rotas /api (no Next 16, o antigo
 * "middleware" se chama proxy): limita as requisições por IP, para proteger as
 * cotas das APIs externas, e libera o CORS só para os apps nativos.
 */
const apiLimiter = createRateLimiter({ limit: apiLimitPerMinute() });

/**
 * Origens dos apps (a interface roda empacotada no app e chama esta API):
 * Android (Capacitor) e Windows/Linux (Tauri). Nenhum site de fora entra na lista.
 */
export const APP_ORIGINS = new Set([
  "https://localhost", // Capacitor no Android (esquema https padrão)
  "capacitor://localhost", // Capacitor (esquema próprio)
  "http://tauri.localhost", // Tauri no Windows
  "tauri://localhost", // Tauri no Linux e no macOS
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !APP_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}

export function proxy(request: NextRequest) {
  const cors = corsHeaders(request.headers.get("origin"));
  // Pré-verificação do CORS (o app pergunta antes de mandar o POST em JSON).
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
  }
  const result = apiLimiter.check(clientIp(request));
  if (!result.ok) {
    return NextResponse.json(
      { error: "Muitas requisições. Tente de novo em instantes." },
      { status: 429, headers: { "Retry-After": String(result.retryAfterS), ...cors } },
    );
  }
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
