/**
 * Relatórios formais da rota (de saída, antes da viagem, e final, depois dela),
 * montados como documento HTML para imprimir ou salvar em PDF pelo navegador.
 * Todo texto passa por `esc`; o mapa entra como imagem (data URL).
 */
import { esc, type TripAnalysis } from "./report-email";
import type { Locale } from "./i18n";
import type { TripReport } from "./trip-report";
import type { TripSummary } from "./trip";

export const APP_AUTHOR = "Giosepe Luiz dos Santos";

/** Uma linha da tabela de paradas: o trecho que chega nela e o que acontece lá. */
export interface ReportRow {
  n: string;
  name: string;
  arriveAt: Date | null;
  dwellSeconds: number;
  leaveAt: Date | null;
  legSeconds: number;
  legMeters: number | null;
  breakSeconds: number;
}

interface Common {
  locale: Locale;
  version: string;
  generatedAt: Date;
  mapImage: string | null;
  logoUrl: string;
  startName: string;
  endName: string | null;
  roundTrip: boolean;
}

export interface DepartureReport extends Common {
  departAt: Date;
  arriveAt: Date;
  totalSeconds: number;
  driveSeconds: number;
  dwellSeconds: number;
  breakSeconds: number;
  totalMeters: number | null;
  rows: ReportRow[];
  aiComment: string | null;
}

export interface FinalReport extends Common {
  summary: TripSummary;
  trip: TripReport["trip"];
  rows: ReportRow[];
  analysis: TripAnalysis | null;
}

interface L {
  app: string;
  depTitle: string;
  finalTitle: string;
  generated: string;
  version: string;
  author: string;
  route: string;
  roundTrip: string;
  noEnd: string;
  overview: string;
  map: string;
  stops: string;
  stopCount: string;
  n: string;
  place: string;
  arrive: string;
  dwell: string;
  leave: string;
  drive: string;
  distance: string;
  rest: string;
  departure: string;
  arrival: string;
  totalTime: string;
  driving: string;
  stopped: string;
  restBreaks: string;
  totalDistance: string;
  aiComment: string;
  aiNote: string;
  analysis: string;
  planned: string;
  actual: string;
  diff: string;
  comparison: string;
  charts: string;
  chartLegs: string;
  chartTime: string;
  moving: string;
  paused: string;
  avgSpeed: string;
  reroutes: string;
  stopsDone: string;
  legs: string;
  leg: string;
  start: string;
  end: string;
  backToStart: string;
  depIntro: (start: string, n: number, end: string, dep: string, arr: string, total: string, km: string) => string;
  depBreaks: (count: number, total: string) => string;
  finalIntro: (actual: string, planned: string | null, km: string, done: number, planned2: number) => string;
  finalSpeed: (avg: string, stopped: string) => string;
  printHint: string;
  verdict: Record<TripAnalysis["verdict"], string>;
  footer: (author: string, version: string, date: string) => string;
}

const ptBR: L = {
  app: "Planejador de Rotas",
  depTitle: "Relatório de saída",
  finalTitle: "Relatório final da viagem",
  generated: "Gerado em",
  version: "Versão do app",
  author: "Criador do aplicativo",
  route: "Rota",
  roundTrip: "ida e volta",
  noEnd: "termina na última parada",
  overview: "Resumo",
  map: "Mapa da rota",
  stops: "Sequência de paradas",
  stopCount: "Paradas",
  n: "Nº",
  place: "Local",
  arrive: "Chegada",
  dwell: "Permanência",
  leave: "Saída",
  drive: "Direção",
  distance: "Distância",
  rest: "Pausa",
  departure: "Saída",
  arrival: "Chegada",
  totalTime: "Tempo total",
  driving: "Dirigindo",
  stopped: "Parado",
  restBreaks: "Pausas para descanso",
  totalDistance: "Distância total",
  aiComment: "Comentário sobre a ordem das paradas",
  aiNote: "Texto gerado por IA; pode conter imprecisões. A ordem das paradas vem sempre do algoritmo.",
  analysis: "Análise técnica",
  planned: "Previsto",
  actual: "Real",
  diff: "Diferença",
  comparison: "Previsto e real",
  charts: "Gráficos",
  chartLegs: "Tempo dirigindo por trecho (min)",
  chartTime: "Distribuição do tempo da viagem",
  moving: "Em movimento",
  paused: "Pausado",
  avgSpeed: "Velocidade média em movimento",
  reroutes: "Recálculos de rota",
  stopsDone: "Paradas concluídas",
  legs: "Trechos",
  leg: "Trecho",
  start: "Início",
  end: "Fim",
  backToStart: "Volta ao início",
  depIntro: (s, n, e, d, a, t, k) =>
    `A rota sai de ${s}, passa por ${n} parada(s) e ${e}. A saída está prevista para ${d} e a chegada para ${a}, num total de ${t}${k ? ` e cerca de ${k}` : ""}.`,
  depBreaks: (c, t) => `Estão planejadas ${c} pausa(s) para descanso, somando ${t}, já incluídas nos horários.`,
  finalIntro: (a, p, k, d, n) =>
    `A viagem levou ${a}${p ? `, contra ${p} previstos` : ""}, e percorreu ${k}. Foram concluídas ${d} de ${n} parada(s).`,
  finalSpeed: (v, s) => `A velocidade média em movimento foi de ${v}, e o tempo parado somou ${s}.`,
  printHint: "Para salvar em PDF, escolha \"Salvar como PDF\" na janela de impressão.",
  verdict: { good: "Dentro do previsto", fair: "Desvios moderados", poor: "Desvios grandes" },
  footer: (a, v, d) => `Planejador de Rotas ${v} · criado por ${a} · gerado em ${d}`,
};

const ptPT: L = {
  ...ptBR,
  app: "Planeador de Rotas",
  depTitle: "Relatório de partida",
  generated: "Gerado a",
  version: "Versão da app",
  author: "Criador da aplicação",
  stopped: "Parado",
  printHint: "Para guardar em PDF, escolha \"Guardar como PDF\" na janela de impressão.",
  footer: (a, v, d) => `Planeador de Rotas ${v} · criado por ${a} · gerado a ${d}`,
};

const enGB: L = {
  app: "Route Planner",
  depTitle: "Departure report",
  finalTitle: "Final trip report",
  generated: "Generated on",
  version: "App version",
  author: "App creator",
  route: "Route",
  roundTrip: "round trip",
  noEnd: "ends at the last stop",
  overview: "Summary",
  map: "Route map",
  stops: "Stop sequence",
  stopCount: "Stops",
  n: "No.",
  place: "Place",
  arrive: "Arrival",
  dwell: "Dwell",
  leave: "Departure",
  drive: "Driving",
  distance: "Distance",
  rest: "Break",
  departure: "Departure",
  arrival: "Arrival",
  totalTime: "Total time",
  driving: "Driving",
  stopped: "Stopped",
  restBreaks: "Rest breaks",
  totalDistance: "Total distance",
  aiComment: "Comment on the stop order",
  aiNote: "AI-generated text; it may contain inaccuracies. The stop order always comes from the algorithm.",
  analysis: "Technical analysis",
  planned: "Planned",
  actual: "Actual",
  diff: "Difference",
  comparison: "Planned and actual",
  charts: "Charts",
  chartLegs: "Driving time per leg (min)",
  chartTime: "How the trip time was spent",
  moving: "Moving",
  paused: "Paused",
  avgSpeed: "Average moving speed",
  reroutes: "Reroutes",
  stopsDone: "Stops completed",
  legs: "Legs",
  leg: "Leg",
  start: "Start",
  end: "End",
  backToStart: "Back to start",
  depIntro: (s, n, e, d, a, t, k) =>
    `The route leaves from ${s}, visits ${n} stop(s) and ${e}. Departure is planned for ${d} and arrival for ${a}, ${t} in total${k ? ` over about ${k}` : ""}.`,
  depBreaks: (c, t) => `${c} rest break(s) are planned, adding up to ${t}, already included in the times.`,
  finalIntro: (a, p, k, d, n) => `The trip took ${a}${p ? `, against ${p} planned` : ""}, covering ${k}. ${d} of ${n} stop(s) were completed.`,
  finalSpeed: (v, s) => `Average moving speed was ${v}, and time stopped added up to ${s}.`,
  printHint: "To save as PDF, choose \"Save as PDF\" in the print dialog.",
  verdict: { good: "On plan", fair: "Moderate deviations", poor: "Large deviations" },
  footer: (a, v, d) => `Route Planner ${v} · created by ${a} · generated on ${d}`,
};

const esES: L = {
  app: "Planificador de Rutas",
  depTitle: "Informe de salida",
  finalTitle: "Informe final del viaje",
  generated: "Generado el",
  version: "Versión de la app",
  author: "Creador de la aplicación",
  route: "Ruta",
  roundTrip: "ida y vuelta",
  noEnd: "termina en la última parada",
  overview: "Resumen",
  map: "Mapa de la ruta",
  stops: "Secuencia de paradas",
  stopCount: "Paradas",
  n: "N.º",
  place: "Lugar",
  arrive: "Llegada",
  dwell: "Estancia",
  leave: "Salida",
  drive: "Conducción",
  distance: "Distancia",
  rest: "Pausa",
  departure: "Salida",
  arrival: "Llegada",
  totalTime: "Tiempo total",
  driving: "Conduciendo",
  stopped: "Parado",
  restBreaks: "Pausas de descanso",
  totalDistance: "Distancia total",
  aiComment: "Comentario sobre el orden de las paradas",
  aiNote: "Texto generado por IA; puede contener imprecisiones. El orden de las paradas siempre viene del algoritmo.",
  analysis: "Análisis técnico",
  planned: "Previsto",
  actual: "Real",
  diff: "Diferencia",
  comparison: "Previsto y real",
  charts: "Gráficos",
  chartLegs: "Tiempo de conducción por tramo (min)",
  chartTime: "Reparto del tiempo del viaje",
  moving: "En movimiento",
  paused: "En pausa",
  avgSpeed: "Velocidad media en movimiento",
  reroutes: "Recálculos de ruta",
  stopsDone: "Paradas completadas",
  legs: "Tramos",
  leg: "Tramo",
  start: "Inicio",
  end: "Fin",
  backToStart: "Vuelta al inicio",
  depIntro: (s, n, e, d, a, t, k) =>
    `La ruta sale de ${s}, pasa por ${n} parada(s) y ${e}. La salida está prevista a las ${d} y la llegada a las ${a}, con un total de ${t}${k ? ` y unos ${k}` : ""}.`,
  depBreaks: (c, t) => `Hay ${c} pausa(s) de descanso planificadas, que suman ${t}, ya incluidas en los horarios.`,
  finalIntro: (a, p, k, d, n) => `El viaje duró ${a}${p ? `, frente a ${p} previstos` : ""}, y recorrió ${k}. Se completaron ${d} de ${n} parada(s).`,
  finalSpeed: (v, s) => `La velocidad media en movimiento fue de ${v} y el tiempo parado sumó ${s}.`,
  printHint: "Para guardarlo en PDF, elige \"Guardar como PDF\" en la ventana de impresión.",
  verdict: { good: "Según lo previsto", fair: "Desvíos moderados", poor: "Desvíos grandes" },
  footer: (a, v, d) => `Planificador de Rutas ${v} · creado por ${a} · generado el ${d}`,
};

const LABELS: Record<Locale, L> = { "pt-BR": ptBR, "pt-PT": ptPT, "en-GB": enGB, "es-ES": esES };

// ---------- Formatação ----------

const dur = (s: number | null) => {
  if (s === null) return "—";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")} min` : ""}`;
};
const km = (m: number | null) => (m === null ? "—" : `${(m / 1000).toFixed(1)} km`);
const time = (locale: Locale, d: Date | null) =>
  d ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "—";
const dateTime = (locale: Locale, d: Date) =>
  d.toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const C = { brand: "#2456d6", ink: "#111827", muted: "#6b7280", line: "#e5e7eb", soft: "#f6f8fc", good: "#15803d", warn: "#b45309", bad: "#b91c1c" };
const tone = (planned: number | null, actual: number | null, fasterIsGood = true) => {
  if (planned === null || actual === null || planned <= 0) return null;
  const pct = (actual - planned) / planned;
  const a = Math.abs(pct);
  const color = fasterIsGood && pct < 0 ? C.good : a <= 0.1 ? C.good : a <= 0.25 ? C.warn : C.bad;
  return { pct, color };
};
const diffCell = (planned: number | null, actual: number | null, fasterIsGood = true) => {
  const d = tone(planned, actual, fasterIsGood);
  if (!d) return "—";
  return `<span class="pill" style="color:${d.color};border-color:${d.color}">${d.pct > 0 ? "+" : d.pct < 0 ? "−" : ""}${Math.abs(d.pct * 100).toFixed(0)}%</span>`;
};

/** Símbolo padrão de IA (estrelas + IA/AI), o mesmo do app. */
const aiBadge = (locale: Locale) =>
  `<span class="ai"><svg viewBox="0 0 20 20" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M8 2.5l1.35 3.9a2 2 0 001.25 1.25L14.5 9l-3.9 1.35a2 2 0 00-1.25 1.25L8 15.5l-1.35-3.9a2 2 0 00-1.25-1.25L1.5 9l3.9-1.35a2 2 0 001.25-1.25z"/><path d="M15 11.5l.65 1.85a1 1 0 00.6.6l1.85.65-1.85.65a1 1 0 00-.6.6L15 17.7l-.65-1.85a1 1 0 00-.6-.6L11.9 14.6l1.85-.65a1 1 0 00.6-.6z"/></svg>${locale.startsWith("en") ? "AI" : "IA"}</span>`;

const STYLE = `
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; color: ${C.ink}; font: 10.5pt/1.5 "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
header { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid ${C.brand}; padding-bottom: 10px; }
header img { width: 44px; height: 44px; border-radius: 11px; }
header .app { font-size: 10pt; color: ${C.brand}; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
h1 { margin: 0; font-size: 20pt; line-height: 1.2; }
h2 { font-size: 12.5pt; color: ${C.brand}; margin: 18px 0 8px; display: flex; align-items: center; gap: 8px; break-after: avoid; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 16px; margin: 10px 0 4px; font-size: 9pt; color: ${C.muted}; }
.meta b { display: block; color: ${C.ink}; font-size: 10pt; }
p { margin: 0 0 8px; text-align: justify; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; break-inside: auto; }
th { text-align: left; font-size: 8pt; letter-spacing: .04em; text-transform: uppercase; color: ${C.muted}; border-bottom: 2px solid ${C.line}; padding: 6px; }
td { border-bottom: 1px solid ${C.line}; padding: 6px; vertical-align: top; }
tr { break-inside: avoid; }
td.r, th.r { text-align: right; white-space: nowrap; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.kpi { border: 1px solid ${C.line}; border-radius: 10px; padding: 8px 10px; background: ${C.soft}; }
.kpi span { display: block; font-size: 8pt; color: ${C.muted}; text-transform: uppercase; letter-spacing: .04em; }
.kpi b { font-size: 13pt; }
.map { width: 100%; border-radius: 10px; border: 1px solid ${C.line}; display: block; max-height: 120mm; object-fit: contain; background: ${C.soft}; }
.pill { display: inline-block; border: 1.5px solid; border-radius: 99px; padding: 0 7px; font-weight: 700; font-size: 8.5pt; }
.ai { display: inline-flex; align-items: center; gap: 3px; background: ${C.brand}; color: #fff; border-radius: 6px; padding: 1px 6px; font-size: 8pt; font-weight: 800; letter-spacing: .04em; }
.box { border: 1px solid ${C.line}; border-radius: 10px; padding: 10px 12px; background: ${C.soft}; break-inside: avoid; }
.finding { border-left: 4px solid; padding: 4px 10px; margin: 8px 0; background: #fff; border-radius: 6px; break-inside: avoid; }
.finding b { display: block; }
.note { font-size: 8pt; color: ${C.muted}; margin-top: 6px; }
.charts { display: grid; grid-template-columns: 3fr 2fr; gap: 14px; align-items: start; break-inside: avoid; }
.chart-title { font-size: 9pt; font-weight: 700; margin-bottom: 4px; }
footer { margin-top: 22px; border-top: 1px solid ${C.line}; padding-top: 8px; font-size: 8pt; color: ${C.muted}; text-align: center; }
.hint { background: #fff7d6; border: 1px solid #f1d27a; border-radius: 8px; padding: 6px 10px; font-size: 9pt; margin-bottom: 10px; }
@media print { .hint { display: none; } .page { padding: 0; } }
`;

function shell(locale: Locale, title: string, L: L, c: Common, body: string): string {
  const generated = dateTime(locale, c.generatedAt);
  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(`${title} · ${L.app}`)}</title><style>${STYLE}</style></head><body><div class="page">
<div class="hint">${esc(L.printHint)}</div>
<header><img src="${esc(c.logoUrl)}" alt=""><div><div class="app">${esc(L.app)}</div><h1>${esc(title)}</h1></div></header>
<div class="meta">
<div>${esc(L.generated)}<b>${esc(generated)}</b></div>
<div>${esc(L.version)}<b>${esc(c.version)}</b></div>
<div>${esc(L.author)}<b>${esc(APP_AUTHOR)}</b></div>
<div style="grid-column:1/-1">${esc(L.route)}<b>${esc(c.startName)} → ${esc(c.roundTrip ? `${c.startName} (${L.roundTrip})` : (c.endName ?? L.noEnd))}</b></div>
</div>
${body}
<footer>${esc(L.footer(APP_AUTHOR, c.version, generated))}</footer>
</div></body></html>`;
}

const kpi = (label: string, value: string) => `<div class="kpi"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
const mapBlock = (L: L, c: Common) => (c.mapImage ? `<h2>${esc(L.map)}</h2><img class="map" src="${esc(c.mapImage)}" alt="${esc(L.map)}">` : "");

function stopsTable(L: L, locale: Locale, rows: ReportRow[]): string {
  return `<table><tr><th>${esc(L.n)}</th><th>${esc(L.place)}</th><th class="r">${esc(L.drive)}</th><th class="r">${esc(L.distance)}</th><th class="r">${esc(L.rest)}</th><th class="r">${esc(L.arrive)}</th><th class="r">${esc(L.dwell)}</th><th class="r">${esc(L.leave)}</th></tr>${rows
    .map(
      (r) =>
        `<tr><td><b>${esc(r.n)}</b></td><td>${esc(r.name)}</td><td class="r">${esc(dur(r.legSeconds))}</td><td class="r">${esc(km(r.legMeters))}</td><td class="r">${r.breakSeconds ? esc(dur(r.breakSeconds)) : "—"}</td><td class="r">${esc(time(locale, r.arriveAt))}</td><td class="r">${r.dwellSeconds ? esc(dur(r.dwellSeconds)) : "—"}</td><td class="r">${esc(time(locale, r.leaveAt))}</td></tr>`,
    )
    .join("")}</table>`;
}

export function departureReportHtml(r: DepartureReport): string {
  const L = LABELS[r.locale] ?? ptBR;
  const stopsCount = r.rows.length - (r.roundTrip || r.endName ? 1 : 0);
  const endText = r.roundTrip ? L.backToStart.toLowerCase() : r.endName ? `${L.end.toLowerCase()}: ${r.endName}` : L.noEnd;
  const breaksCount = r.rows.filter((row) => row.breakSeconds > 0).length;
  const body = `
<h2>${esc(L.overview)}</h2>
<p>${esc(L.depIntro(r.startName, stopsCount, endText, dateTime(r.locale, r.departAt), dateTime(r.locale, r.arriveAt), dur(r.totalSeconds), r.totalMeters === null ? "" : km(r.totalMeters)))}</p>
${breaksCount ? `<p>${esc(L.depBreaks(breaksCount, dur(r.breakSeconds)))}</p>` : ""}
<div class="kpis">${kpi(L.departure, time(r.locale, r.departAt))}${kpi(L.arrival, time(r.locale, r.arriveAt))}${kpi(L.totalTime, dur(r.totalSeconds))}${kpi(L.totalDistance, km(r.totalMeters))}${kpi(L.driving, dur(r.driveSeconds))}${kpi(L.dwell, dur(r.dwellSeconds))}${kpi(L.restBreaks, dur(r.breakSeconds))}${kpi(L.stopCount, String(stopsCount))}</div>
${mapBlock(L, r)}
<h2>${esc(L.stops)}</h2>
${stopsTable(L, r.locale, r.rows)}
${r.aiComment ? `<h2>${aiBadge(r.locale)}${esc(L.aiComment)}</h2><div class="box"><p>${esc(r.aiComment)}</p><div class="note">${esc(L.aiNote)}</div></div>` : ""}`;
  return shell(r.locale, L.depTitle, L, r, body);
}

/** Barras agrupadas (previsto × real) em SVG. */
function legsChart(L: L, legs: TripReport["trip"]["legs"]): string {
  const data = legs.map((l, i) => ({ i, p: (l.plannedSeconds ?? 0) / 60, a: (l.actualSeconds ?? 0) / 60 }));
  if (data.length === 0) return "";
  const max = Math.max(1, ...data.flatMap((d) => [d.p, d.a]));
  const W = 420;
  const H = 190;
  const left = 30;
  const bottom = 24;
  const slot = (W - left - 6) / data.length;
  const bar = Math.min(18, slot / 2.6);
  const y = (v: number) => H - bottom - (v / max) * (H - bottom - 10);
  const ticks = [0, max / 2, max].map((v) => `<text x="${left - 4}" y="${y(v) + 3}" font-size="8" text-anchor="end" fill="${C.muted}">${Math.round(v)}</text><line x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${C.line}"/>`);
  const bars = data.map((d) => {
    const x = left + slot * d.i + slot / 2;
    const color = tone(d.p || null, d.a || null)?.color ?? C.muted;
    return `<rect x="${x - bar - 1}" y="${y(d.p)}" width="${bar}" height="${H - bottom - y(d.p)}" fill="#c7d2fe" rx="2"/><rect x="${x + 1}" y="${y(d.a)}" width="${bar}" height="${H - bottom - y(d.a)}" fill="${color}" rx="2"/><text x="${x}" y="${H - bottom + 12}" font-size="8.5" text-anchor="middle" fill="${C.ink}">${d.i + 1}</text>`;
  });
  return `<div><div class="chart-title">${esc(L.chartLegs)}</div><svg viewBox="0 0 ${W} ${H + 14}" width="100%">${ticks.join("")}${bars.join("")}<rect x="${left}" y="${H + 2}" width="9" height="9" fill="#c7d2fe"/><text x="${left + 13}" y="${H + 10}" font-size="8.5">${esc(L.planned)}</text><rect x="${left + 80}" y="${H + 2}" width="9" height="9" fill="${C.good}"/><text x="${left + 93}" y="${H + 10}" font-size="8.5">${esc(L.actual)}</text></svg></div>`;
}

/** Rosca do tempo: em movimento, parado e pausado. */
function timeChart(L: L, s: TripSummary, pausedSeconds: number): string {
  const moving = Math.max(0, s.actualSeconds - s.stoppedSeconds);
  const stopped = Math.max(0, s.stoppedSeconds - pausedSeconds);
  const parts = [
    { label: L.moving, v: moving, color: C.brand },
    { label: L.stopped, v: stopped, color: "#f59e0b" },
    { label: L.paused, v: pausedSeconds, color: "#9ca3af" },
  ].filter((p) => p.v > 0);
  const total = parts.reduce((sum, p) => sum + p.v, 0);
  if (total <= 0) return "";
  const r = 52;
  const cx = 70;
  const cy = 70;
  let angle = -Math.PI / 2;
  const arcs = parts.map((p) => {
    const sweep = (p.v / total) * Math.PI * 2;
    if (sweep >= Math.PI * 2 - 1e-6) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.color}" stroke-width="22"/>`;
    const a0 = angle;
    angle += sweep;
    const [x0, y0, x1, y1] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
    return `<path d="M${x0} ${y0}A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1} ${y1}" fill="none" stroke="${p.color}" stroke-width="22"/>`;
  });
  const legend = parts.map((p, i) => `<rect x="150" y="${30 + i * 22}" width="10" height="10" rx="2" fill="${p.color}"/><text x="166" y="${39 + i * 22}" font-size="9">${esc(p.label)}: ${esc(dur(p.v))} (${Math.round((p.v / total) * 100)}%)</text>`);
  return `<div><div class="chart-title">${esc(L.chartTime)}</div><svg viewBox="0 0 300 140" width="100%">${arcs.join("")}${legend.join("")}</svg></div>`;
}

export function finalReportHtml(r: FinalReport): string {
  const L = LABELS[r.locale] ?? ptBR;
  const s = r.summary;
  const t = r.trip;
  const avg = s.averageKmh === null ? "—" : `${s.averageKmh.toFixed(0)} km/h`;
  const comparison = `<table><tr><th></th><th class="r">${esc(L.planned)}</th><th class="r">${esc(L.actual)}</th><th class="r">${esc(L.diff)}</th></tr>
<tr><td>${esc(L.totalTime)}</td><td class="r">${esc(dur(s.plannedSeconds))}</td><td class="r"><b>${esc(dur(s.actualSeconds))}</b></td><td class="r">${diffCell(s.plannedSeconds, s.actualSeconds)}</td></tr>
<tr><td>${esc(L.totalDistance)}</td><td class="r">${esc(km(s.plannedMeters))}</td><td class="r"><b>${esc(km(s.actualMeters))}</b></td><td class="r">${diffCell(s.plannedMeters, s.actualMeters, false)}</td></tr>
<tr><td>${esc(L.arrival)}</td><td class="r">${esc(time(r.locale, s.plannedArriveAt === null ? null : new Date(s.plannedArriveAt)))}</td><td class="r"><b>${esc(time(r.locale, new Date(s.arrivedAt)))}</b></td><td class="r">—</td></tr>
${t.legs
  .map(
    (leg, i) =>
      `<tr><td>${esc(`${L.leg} ${i + 1}`)}${r.rows[i] ? ` <span style="color:${C.muted}">· ${esc(r.rows[i].name)}</span>` : ""}</td><td class="r">${esc(dur(leg.plannedSeconds))}</td><td class="r"><b>${esc(dur(leg.actualSeconds))}</b></td><td class="r">${diffCell(leg.plannedSeconds, leg.actualSeconds)}</td></tr>`,
  )
  .join("")}</table>`;
  const a = r.analysis;
  const ai = a
    ? `<h2>${aiBadge(r.locale)}${esc(L.analysis)}</h2><div class="box"><p><span class="pill" style="color:${a.verdict === "good" ? C.good : a.verdict === "fair" ? C.warn : C.bad};border-color:currentColor">${esc(L.verdict[a.verdict])}</span></p><p>${esc(a.summary)}</p>${a.findings
        .map((f) => `<div class="finding" style="border-color:${f.level === "good" ? C.good : f.level === "warn" ? C.warn : C.bad}"><b>${esc(f.title)}</b>${esc(f.detail)}</div>`)
        .join("")}<div class="note">${esc(L.aiNote.split(".")[0])}.</div></div>`
    : "";
  const body = `
<h2>${esc(L.overview)}</h2>
<p>${esc(L.finalIntro(dur(s.actualSeconds), s.plannedSeconds === null ? null : dur(s.plannedSeconds), km(s.actualMeters), s.stopsDone, t.stopsPlanned))}</p>
<p>${esc(L.finalSpeed(avg, dur(s.stoppedSeconds)))}</p>
<div class="kpis">${kpi(L.totalTime, dur(s.actualSeconds))}${kpi(L.totalDistance, km(s.actualMeters))}${kpi(L.avgSpeed, avg)}${kpi(L.stopsDone, `${s.stopsDone}/${t.stopsPlanned}`)}${kpi(L.stopped, dur(s.stoppedSeconds))}${kpi(L.paused, dur(t.pausedSeconds))}${kpi(L.restBreaks, `${t.restBreaks} · ${t.restBreakMinutes} min`)}${kpi(L.reroutes, String(t.reroutes))}</div>
${mapBlock(L, r)}
<h2>${esc(L.comparison)}</h2>
${comparison}
<h2>${esc(L.charts)}</h2>
<div class="charts">${legsChart(L, t.legs)}${timeChart(L, s, t.pausedSeconds)}</div>
${ai}
<h2>${esc(L.stops)}</h2>
${stopsTable(L, r.locale, r.rows)}`;
  return shell(r.locale, L.finalTitle, L, r, body);
}

/**
 * Abre o relatório numa aba nova e chama a impressão (de onde se salva o PDF).
 * A aba é aberta antes (no clique), porque depois de esperar o mapa o
 * navegador bloquearia a janela.
 */
export function openReportWindow(): Window | null {
  return window.open("", "_blank");
}

export function showReport(target: Window | null, html: string): boolean {
  if (!target || target.closed) return false;
  const doc = target.document;
  doc.open();
  doc.write(html);
  doc.close();
  // Imprime quando o logo e o mapa terminarem de carregar (ou em 4 s, no máximo).
  const started = Date.now();
  const wait = () => {
    const ready = [...doc.images].every((img) => img.complete);
    if (ready || Date.now() - started > 4000) {
      target.focus();
      target.print();
    } else window.setTimeout(wait, 150);
  };
  window.setTimeout(wait, 300);
  return true;
}
