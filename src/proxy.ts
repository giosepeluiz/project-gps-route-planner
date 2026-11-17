import { NextResponse, type NextRequest } from "next/server";
import { apiLimitPerMinute, createRateLimiter } from "@/lib/server/rate-limit";

/**
 * Roda antes de cada requisição às rotas /api (no Next 16, o antigo
 * "middleware" se chama proxy) e limita as requisições por IP, para
 * proteger as cotas das APIs externas.
 */
const apiLimiter = createRateLimiter({ limit: apiLimitPerMinute() });

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}

export function proxy(request: NextRequest) {
  const result = apiLimiter.check(clientIp(request));
  if (!result.ok) {
    return NextResponse.json(
      { error: "Muitas requisições. Tente de novo em instantes." },
      { status: 429, headers: { "Retry-After": String(result.retryAfterS) } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
