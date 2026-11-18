/**
 * Estatísticas anônimas da viagem: o formato (validado igual no navegador e no
 * servidor) e o texto do e-mail. Só números, escolhas da interface e dados
 * técnicos do aparelho; nada de localização, nomes de lugares ou texto livre.
 */
import { z } from "zod";
import { LOCALES } from "./i18n";

const seconds = z.number().int().min(0).max(7 * 24 * 3600);
const meters = z.number().int().min(0).max(5_000_000);
const count = z.number().int().min(0).max(10_000);
/**
 * Texto técnico do aparelho (modelo, sistema, navegador): só letras, números e
 * pontuação simples. Recusa <, >, aspas, & e quebras de linha, que poderiam
 * virar HTML ou forjar cabeçalhos.
 */
const techText = z
  .string()
  .max(60)
  .regex(/^[\p{L}\p{N} ._\-()+,/;:]*$/u);

export const TripLegReport = z.strictObject({
  plannedSeconds: seconds.nullable(),
  actualSeconds: seconds.nullable(),
  plannedMeters: meters.nullable(),
  plannedDwellSeconds: seconds.nullable(),
  actualDwellSeconds: seconds.nullable(),
  /** O trecho teve pausa para descanso planejada. */
  restBreak: z.boolean(),
});

export const TripReport = z.strictObject({
  appVersion: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  locale: z.enum(LOCALES),
  trip: z.strictObject({
    plannedSeconds: seconds.nullable(),
    actualSeconds: seconds,
    plannedMeters: meters.nullable(),
    actualMeters: meters,
    stoppedSeconds: seconds,
    averageKmh: z.number().min(0).max(400).nullable(),
    stopsPlanned: count,
    stopsDone: count,
    roundTrip: z.boolean(),
    hasEnd: z.boolean(),
    pausesUsed: count,
    pausedSeconds: seconds,
    /** Vezes em que ficou mais de 5 min parado no mesmo lugar sem usar o pausar. */
    longStillCount: count,
    longStillSeconds: seconds,
    restBreaks: count,
    restBreakMinutes: z.number().int().min(0).max(100_000),
    reroutes: count,
    headingUp: z.boolean(),
    averageGpsAccuracyM: z.number().min(0).max(100_000).nullable(),
    legs: z.array(TripLegReport).max(50),
  }),
  device: z.strictObject({
    model: techText,
    platform: techText,
    browser: techText,
    screen: z.string().regex(/^\d{2,5}x\d{2,5}$/),
    viewport: z.string().regex(/^\d{2,5}x\d{2,5}$/),
    pixelRatio: z.number().min(0.5).max(10),
    touch: z.boolean(),
    orientation: z.enum(["portrait", "landscape", "unknown"]),
    standalone: z.boolean(),
    theme: z.enum(["light", "dark"]),
    fontSize: z.enum(["sm", "md", "lg", "xl"]),
  }),
});
export type TripReport = z.infer<typeof TripReport>;

/** Pedido ao servidor: o relatório e, se a pessoa quiser, o e-mail para a cópia. */
export const TripReportRequest = z.strictObject({
  report: TripReport,
  copyTo: z.email().max(254).nullable(),
});

/** Texto do e-mail (no idioma do app): ver report-email.ts. */
export { reportText } from "./report-email";

/** Depois de um envio, novo envio só depois deste tempo (no aparelho e no servidor). */
export const REPORT_COOLDOWN_MS = 30 * 60_000;

/**
 * Viagem com números perto de zero (rota curtinha criada só para mandar
 * e-mails): não vale como estatística e não é enviada.
 */
export function isTrivialTrip(trip: TripReport["trip"]): boolean {
  return trip.actualMeters < 500 || trip.actualSeconds < 180;
}
