/**
 * Análise técnica da viagem por IA, para o e-mail das estatísticas. A IA recebe
 * só os números já validados (nada de lugares) e devolve um JSON conferido
 * campo a campo; sem IA, o e-mail sai sem a análise.
 */
import { z } from "zod";
import { MESSAGES } from "../messages";
import type { TripAnalysis } from "../report-email";
import type { TripReport } from "../trip-report";
import type { AiService } from "./ai";

/** Texto da IA: sem < > nem caracteres de controle (o HTML ainda escapa tudo). */
const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(3)
    .max(max)
    .transform((v) => v.replace(/[<>\u0000-\u001f\u007f]/g, " "));

export const TripAnalysisSchema = z.object({
  verdict: z.enum(["good", "fair", "poor"]),
  summary: plain(900),
  findings: z
    .array(z.object({ level: z.enum(["good", "warn", "bad"]), title: plain(90), detail: plain(500) }))
    .min(1)
    .max(7),
});

const system = (language: string) => `Você é um analista técnico de navegação veicular. Recebe as estatísticas anônimas de UMA viagem feita com um planejador de rotas multiparadas (o tempo previsto vem do TomTom com trânsito; o real, do GPS do celular).
Faça uma análise técnica detalhada, objetiva e útil, escrita em ${language}.
Responda SOMENTE com JSON no formato:
{"verdict":"good|fair|poor","summary":"3 a 5 frases","findings":[{"level":"good|warn|bad","title":"título curto","detail":"1 a 3 frases"}]}
Regras:
- verdict: good se o tempo real ficou até ~10% do previsto, fair até ~25%, poor acima (considere pausas e tempo parado ao julgar).
- Compare previsto x real no total e em cada trecho; diga se o desvio faz sentido (paradas, pausas, recálculos, velocidade média, precisão do GPS).
- Separe tempo dirigindo de tempo parado/permanência quando os números permitirem.
- Aponte possíveis causas técnicas (trânsito, GPS impreciso, desvio de rota, permanência maior que a planejada) e, se houver, sugestões para planejar melhor.
- 3 a 6 findings. Use números concretos (minutos, %, km, km/h); nunca segundos.
- A pausa para descanso planejada já está incluída no tempo previsto do trecho.
- Não invente dados que não estão na entrada. Não use HTML nem markdown.`;

const mins = (s: number | null) => (s === null ? null : Math.round(s / 6) / 10);
const kms = (m: number | null) => (m === null ? null : Math.round(m / 100) / 10);

/** Entrada da IA: só os números da viagem, em minutos e km (o aparelho entra resumido). */
export function analysisInput(r: TripReport): string {
  const { trip: t, device } = r;
  return JSON.stringify({
    totalMinutes: { planned: mins(t.plannedSeconds), actual: mins(t.actualSeconds) },
    totalKm: { planned: kms(t.plannedMeters), driven: kms(t.actualMeters) },
    stoppedMinutes: mins(t.stoppedSeconds),
    averageMovingKmh: t.averageKmh,
    stops: { planned: t.stopsPlanned, done: t.stopsDone },
    roundTrip: t.roundTrip,
    hasEnd: t.hasEnd,
    pauseButton: { times: t.pausesUsed, minutes: mins(t.pausedSeconds) },
    stillOver5MinWithoutPause: { times: t.longStillCount, minutes: mins(t.longStillSeconds) },
    plannedRestBreaks: { count: t.restBreaks, minutes: t.restBreakMinutes },
    reroutesAfterLeavingRoute: t.reroutes,
    averageGpsAccuracyM: t.averageGpsAccuracyM,
    legs: t.legs.map((leg, i) => ({
      leg: i + 1,
      drivingMinutes: { planned: mins(leg.plannedSeconds), actual: mins(leg.actualSeconds) },
      plannedKm: kms(leg.plannedMeters),
      dwellMinutesAtArrival: { planned: mins(leg.plannedDwellSeconds), actual: mins(leg.actualDwellSeconds) },
      hasPlannedRestBreak: leg.restBreak,
    })),
    device: { platform: device.platform, browser: device.browser, installedAsApp: device.standalone },
  });
}

export async function analyzeTrip(ai: AiService, r: TripReport): Promise<TripAnalysis | null> {
  const language = MESSAGES[r.locale].aiLanguage;
  // Análise mais longa que as outras chamadas: mais tokens e mais tempo, sem travar o envio por muito tempo.
  const result = await ai.run(TripAnalysisSchema, system(language), analysisInput(r), { timeoutMs: 15_000, maxTokens: 2048 });
  return result?.data ?? null;
}
