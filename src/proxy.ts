import { NextResponse, type NextRequest } from "next/server";
import { apiLimitPerMinute, createRateLimiter, LOGIN_LIMIT_PER_MINUTE } from "@/lib/server/rate-limit";
import { authConfig, SESSION_COOKIE, verifySession } from "@/lib/server/session";

/**
 * Roda antes de cada requisição (no Next 16, o antigo "middleware" se chama proxy):
 * 1) limita as requisições por IP nas rotas /api;
 * 2) exige a senha (cookie assinado) no site e nas rotas /api.
 */
const apiLimiter = createRateLimiter({ limit: apiLimitPerMinute() });
const loginLimiter = createRateLimiter({ limit: LOGIN_LIMIT_PER_MINUTE });

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isLogin = pathname === "/login" || pathname === "/api/login";

  if (isApi) {
    const limiter = pathname === "/api/login" ? loginLimiter : apiLimiter;
    const result = limiter.check(clientIp(request));
    if (!result.ok) {
      return NextResponse.json(
        { error: "Muitas requisições. Tente de novo em instantes." },
        { status: 429, headers: { "Retry-After": String(result.retryAfterS) } },
      );
    }
  }

  const auth = authConfig();
  if (auth.mode === "open" || isLogin) return NextResponse.next();

  if (auth.mode === "locked") {
    const message = "Site bloqueado: defina APP_PASSWORD nas variáveis de ambiente.";
    return isApi
      ? NextResponse.json({ error: message }, { status: 503 })
      : new NextResponse(message, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (await verifySession(auth.secret, request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (isApi) return NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Fica de fora só o que é estático: arquivos do Next, o ícone e o worker do mapa.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|maplibre/).*)"],
};
