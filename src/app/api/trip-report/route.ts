import { NextResponse, type NextRequest } from "next/server";
import { mailerFromEnv } from "@/lib/server/mailer";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { readJsonLimited } from "@/lib/server/read-json";
import { isTrivialTrip, REPORT_COOLDOWN_MS, reportText, TripReportRequest } from "@/lib/trip-report";

/** Um envio a cada 30 minutos por IP: o e-mail não vira ferramenta de spam. */
const limiter = createRateLimiter({ limit: 1, windowMs: REPORT_COOLDOWN_MS });
const MAX_BODY = 16_000;

/**
 * POST /api/trip-report
 * Recebe as estatísticas anônimas da viagem (validadas campo a campo) e envia
 * por e-mail em texto puro para o autor; com `copyTo`, a pessoa recebe a mesma
 * mensagem em CC.
 */
export async function POST(request: NextRequest) {
  const mailer = mailerFromEnv();
  if (!mailer) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const body = await readJsonLimited(request, MAX_BODY);
  if (!body.ok) return NextResponse.json({ error: "Corpo inválido." }, { status: body.status });
  const parsed = TripReportRequest.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const { report, copyTo } = parsed.data;
  // Viagem "de mentira" (quase sem distância ou tempo): não vira e-mail.
  if (isTrivialTrip(report.trip)) return NextResponse.json({ error: "trivial" }, { status: 422 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = limiter.check(ip);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Muitos envios. Tente mais tarde." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterS) } },
    );
  }
  const sent = await mailer.send({
    subject: `Estatísticas de viagem · Planejador de Rotas ${report.appVersion}`,
    text: reportText(report),
    cc: copyTo,
  });
  return sent
    ? NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Falha no envio." }, { status: 502 });
}
