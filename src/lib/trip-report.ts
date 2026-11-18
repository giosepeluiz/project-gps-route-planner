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

const dash = "-";
const min = (s: number | null) => (s === null ? dash : `${Math.round(s / 60)} min`);
const km = (m: number | null) => (m === null ? dash : `${(m / 1000).toFixed(1)} km`);
const yesNo = (v: boolean) => (v ? "sim" : "não");

/** Corpo do e-mail, em texto puro (sem HTML), igual para o autor e para a cópia. */
export function reportText(r: TripReport): string {
  const t = r.trip;
  const d = r.device;
  const lines = [
    "Estatísticas anônimas de uma viagem do Planejador de Rotas.",
    "Não contém localização, nomes de lugares nem dados pessoais.",
    "",
    `Versão do app: ${r.appVersion}`,
    `Idioma: ${r.locale}`,
    "",
    "VIAGEM",
    `Tempo: previsto ${min(t.plannedSeconds)} · real ${min(t.actualSeconds)}`,
    `Distância: prevista ${km(t.plannedMeters)} · percorrida ${km(t.actualMeters)}`,
    `Paradas: ${t.stopsDone} concluídas de ${t.stopsPlanned}`,
    `Ida e volta: ${yesNo(t.roundTrip)} · com fim: ${yesNo(t.hasEnd)}`,
    `Tempo parado: ${min(t.stoppedSeconds)}`,
    `Velocidade média em movimento: ${t.averageKmh === null ? dash : `${t.averageKmh.toFixed(0)} km/h`}`,
    `Botão pausar: ${t.pausesUsed} vez(es), ${min(t.pausedSeconds)}`,
    `Parado mais de 5 min no mesmo lugar sem pausar: ${t.longStillCount} vez(es), ${min(t.longStillSeconds)}`,
    `Pausas para descanso planejadas: ${t.restBreaks} (${t.restBreakMinutes} min)`,
    `Recálculos por sair da rota: ${t.reroutes}`,
    `Mapa girando com a viagem: ${yesNo(t.headingUp)}`,
    `Precisão média do GPS: ${t.averageGpsAccuracyM === null ? dash : `${Math.round(t.averageGpsAccuracyM)} m`}`,
    "",
    "TRECHOS (previsto · real)",
    ...t.legs.map(
      (leg, i) =>
        `${i + 1}. direção ${min(leg.plannedSeconds)} · ${min(leg.actualSeconds)}; distância ${km(leg.plannedMeters)}; permanência ${min(leg.plannedDwellSeconds)} · ${min(leg.actualDwellSeconds)}${leg.restBreak ? "; com pausa para descanso" : ""}`,
    ),
    "",
    "APARELHO",
    `Modelo: ${d.model || dash}`,
    `Sistema: ${d.platform || dash}`,
    `Navegador: ${d.browser || dash}`,
    `Tela: ${d.screen} · janela ${d.viewport} · densidade ${d.pixelRatio}`,
    `Toque: ${yesNo(d.touch)} · orientação ${d.orientation} · instalado como app: ${yesNo(d.standalone)}`,
    `Tema: ${d.theme} · tamanho do texto: ${d.fontSize}`,
  ];
  return lines.join("\n");
}

/** Depois de um envio, novo envio só depois deste tempo (no aparelho e no servidor). */
export const REPORT_COOLDOWN_MS = 30 * 60_000;

/**
 * Viagem com números perto de zero (rota curtinha criada só para mandar
 * e-mails): não vale como estatística e não é enviada.
 */
export function isTrivialTrip(trip: TripReport["trip"]): boolean {
  return trip.actualMeters < 500 || trip.actualSeconds < 180;
}
