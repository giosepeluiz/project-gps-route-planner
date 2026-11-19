import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LOCALES } from "@/lib/i18n";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { readJsonLimited } from "@/lib/server/read-json";
import { getServices } from "@/lib/server/services";
import { analyzeTrip } from "@/lib/server/trip-analysis";
import { TripReport } from "@/lib/trip-report";

/** Análise para o relatório final: poucas por pessoa (cada uma chama a IA). */
const limiter = createRateLimiter({ limit: 4, windowMs: 10 * 60_000 });
export const maxDuration = 60;

const Body = z.strictObject({
  locale: z.enum(LOCALES),
  trip: TripReport.shape.trip,
});

/**
 * POST /api/ai/trip-analysis
 * Análise técnica da viagem (só números, validados campo a campo) para o
 * relatório final. Sem IA, responde { analysis: null } e o relatório sai sem ela.
 */
export async function POST(request: NextRequest) {
  const body = await readJsonLimited(request, 16_000);
  if (!body.ok) return NextResponse.json({ error: "Corpo inválido." }, { status: body.status });
  const parsed = Body.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const headers = { "Cache-Control": "no-store" };
  if (!limiter.check(ip).ok) return NextResponse.json({ analysis: null }, { headers });

  // O aparelho não entra: a análise só usa os números da viagem.
  const report: TripReport = {
    appVersion: "0.0.0",
    locale: parsed.data.locale,
    trip: parsed.data.trip,
    device: {
      model: "", platform: "", browser: "", screen: "00x00", viewport: "00x00", pixelRatio: 1,
      touch: false, orientation: "unknown", standalone: false, theme: "light", fontSize: "md",
    },
  };
  const analysis = await analyzeTrip(getServices().ai, report).catch(() => null);
  return NextResponse.json({ analysis }, { headers });
}
