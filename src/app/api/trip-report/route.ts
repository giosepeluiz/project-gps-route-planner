import { after, NextResponse, type NextRequest } from "next/server";
import { mailerFromEnv } from "@/lib/server/mailer";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { readJsonLimited } from "@/lib/server/read-json";
import { reportHtml, reportSubject, reportText } from "@/lib/report-email";
import { getServices } from "@/lib/server/services";
import { analyzeTrip } from "@/lib/server/trip-analysis";
import { isTrivialTrip, REPORT_COOLDOWN_MS, TripReportRequest } from "@/lib/trip-report";

/** Um envio a cada 30 minutos por IP: o e-mail não vira ferramenta de spam. */
const limiter = createRateLimiter({ limit: 1, windowMs: REPORT_COOLDOWN_MS });
const MAX_BODY = 16_000;
/** A análise da IA e o envio rodam depois da resposta; este é o limite deles. */
export const maxDuration = 60;

/**
 * POST /api/trip-report
 * Recebe as estatísticas anônimas da viagem (validadas campo a campo), pede uma
 * análise técnica à IA (opcional) e envia por e-mail, no idioma do app, em texto
 * e HTML escapado, para o autor; com `copyTo`, a pessoa recebe a mesma mensagem em CC.
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
  const logoUrl = `${request.nextUrl.origin}/email-logo.png`;
  // A análise da IA pode levar vários segundos: a pessoa não espera por ela.
  // Com a IA fora do ar, o e-mail sai sem a análise.
  after(async () => {
    const analysis = await analyzeTrip(getServices().ai, report).catch(() => null);
    await mailer.send({
      subject: reportSubject(report),
      text: reportText(report, analysis),
      html: reportHtml(report, analysis, logoUrl),
      cc: copyTo,
    });
  });
  return NextResponse.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
