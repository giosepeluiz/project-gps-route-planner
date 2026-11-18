/**
 * E-mail das estatísticas anônimas, no idioma escolhido no app: texto puro
 * (também mostrado na prévia) e uma versão em HTML com tabelas e cores.
 * No HTML, todo valor passa por `esc`, inclusive o texto da IA.
 */
import type { Locale } from "./i18n";
import type { TripReport } from "./trip-report";

/** Análise técnica da IA (já validada no servidor). */
export interface TripAnalysis {
  verdict: "good" | "fair" | "poor";
  summary: string;
  findings: { level: "good" | "warn" | "bad"; title: string; detail: string }[];
}

interface Labels {
  app: string;
  subject: (version: string) => string;
  intro: string;
  privacy: string;
  version: string;
  language: string;
  trip: string;
  details: string;
  metric: string;
  planned: string;
  actual: string;
  diff: string;
  time: string;
  distance: string;
  timeLine: (p: string, a: string) => string;
  distanceLine: (p: string, a: string) => string;
  stops: string;
  stopsValue: (done: number, planned: number) => string;
  roundTrip: string;
  hasEnd: string;
  stopped: string;
  avgSpeed: string;
  pauseButton: string;
  timesValue: (n: number, m: string) => string;
  longStill: string;
  restBreaks: string;
  reroutes: string;
  headingUp: string;
  gpsAccuracy: string;
  legs: string;
  legsHeader: string;
  leg: string;
  drive: string;
  dwell: string;
  withBreak: string;
  legLine: (i: number, drive: string, dist: string, dwell: string, rest: boolean) => string;
  device: string;
  model: string;
  system: string;
  browser: string;
  screen: string;
  screenValue: (s: string, v: string, r: number) => string;
  touch: string;
  orientation: string;
  installed: string;
  theme: string;
  fontSize: string;
  yes: string;
  no: string;
  analysis: string;
  verdict: Record<TripAnalysis["verdict"], string>;
  aiNote: string;
  footer: string;
  orientations: Record<"portrait" | "landscape" | "unknown", string>;
  themes: Record<"light" | "dark", string>;
}

const ptBR: Labels = {
  app: "Planejador de Rotas",
  subject: (v) => `Estatísticas de viagem · Planejador de Rotas ${v}`,
  intro: "Estatísticas anônimas de uma viagem do Planejador de Rotas.",
  privacy: "Não contém localização, nomes de lugares nem dados pessoais.",
  version: "Versão do app",
  language: "Idioma",
  trip: "VIAGEM",
  details: "DETALHES",
  metric: "Indicador",
  planned: "Previsto",
  actual: "Real",
  diff: "Diferença",
  time: "Tempo",
  distance: "Distância",
  timeLine: (p, a) => `Tempo: previsto ${p} · real ${a}`,
  distanceLine: (p, a) => `Distância: prevista ${p} · percorrida ${a}`,
  stops: "Paradas",
  stopsValue: (d, p) => `${d} concluídas de ${p}`,
  roundTrip: "Ida e volta",
  hasEnd: "Com fim",
  stopped: "Tempo parado",
  avgSpeed: "Velocidade média em movimento",
  pauseButton: "Botão pausar",
  timesValue: (n, m) => `${n} vez(es), ${m}`,
  longStill: "Parado mais de 5 min no mesmo lugar sem pausar",
  restBreaks: "Pausas para descanso planejadas",
  reroutes: "Recálculos por sair da rota",
  headingUp: "Mapa girando com a viagem",
  gpsAccuracy: "Precisão média do GPS",
  legs: "TRECHOS",
  legsHeader: "TRECHOS (previsto · real)",
  leg: "Trecho",
  drive: "Direção",
  dwell: "Permanência",
  withBreak: "com pausa para descanso",
  legLine: (i, dr, di, dw, r) => `${i}. direção ${dr}; distância ${di}; permanência ${dw}${r ? "; com pausa para descanso" : ""}`,
  device: "APARELHO",
  model: "Modelo",
  system: "Sistema",
  browser: "Navegador",
  screen: "Tela",
  screenValue: (s, v, r) => `${s} · janela ${v} · densidade ${r}`,
  touch: "Toque",
  orientation: "Orientação",
  installed: "Instalado como app",
  theme: "Tema",
  fontSize: "Tamanho do texto",
  yes: "sim",
  no: "não",
  analysis: "Análise técnica (IA)",
  verdict: { good: "Dentro do previsto", fair: "Desvios moderados", poor: "Desvios grandes" },
  aiNote: "Texto gerado por IA a partir só dos números acima; pode conter imprecisões.",
  footer: "Enviado a pedido de quem usou o app. Nenhuma resposta é necessária.",
  orientations: { portrait: "retrato", landscape: "paisagem", unknown: "desconhecida" },
  themes: { light: "claro", dark: "escuro" },
};

const ptPT: Labels = {
  ...ptBR,
  app: "Planeador de Rotas",
  subject: (v) => `Estatísticas de viagem · Planeador de Rotas ${v}`,
  intro: "Estatísticas anónimas de uma viagem do Planeador de Rotas.",
  privacy: "Não contém localização, nomes de locais nem dados pessoais.",
  version: "Versão da app",
  stopped: "Tempo parado",
  longStill: "Parado mais de 5 min no mesmo sítio sem pausar",
  headingUp: "Mapa a rodar com a viagem",
  model: "Modelo",
  installed: "Instalado como app",
  touch: "Ecrã tátil",
  screen: "Ecrã",
  analysis: "Análise técnica (IA)",
  verdict: { good: "Dentro do previsto", fair: "Desvios moderados", poor: "Desvios grandes" },
  aiNote: "Texto gerado por IA apenas a partir dos números acima; pode conter imprecisões.",
  footer: "Enviado a pedido de quem usou a app. Não é necessária resposta.",
};

const enGB: Labels = {
  app: "Route Planner",
  subject: (v) => `Trip statistics · Route Planner ${v}`,
  intro: "Anonymous statistics from a Route Planner trip.",
  privacy: "Contains no location, place names or personal data.",
  version: "App version",
  language: "Language",
  trip: "TRIP",
  details: "DETAILS",
  metric: "Metric",
  planned: "Planned",
  actual: "Actual",
  diff: "Difference",
  time: "Time",
  distance: "Distance",
  timeLine: (p, a) => `Time: planned ${p} · actual ${a}`,
  distanceLine: (p, a) => `Distance: planned ${p} · driven ${a}`,
  stops: "Stops",
  stopsValue: (d, p) => `${d} of ${p} completed`,
  roundTrip: "Round trip",
  hasEnd: "Has end point",
  stopped: "Time stopped",
  avgSpeed: "Average moving speed",
  pauseButton: "Pause button",
  timesValue: (n, m) => `${n} time(s), ${m}`,
  longStill: "Stopped over 5 min in one place without pausing",
  restBreaks: "Planned rest breaks",
  reroutes: "Reroutes after leaving the route",
  headingUp: "Map rotating with the trip",
  gpsAccuracy: "Average GPS accuracy",
  legs: "LEGS",
  legsHeader: "LEGS (planned · actual)",
  leg: "Leg",
  drive: "Driving",
  dwell: "Dwell",
  withBreak: "with rest break",
  legLine: (i, dr, di, dw, r) => `${i}. driving ${dr}; distance ${di}; dwell ${dw}${r ? "; with rest break" : ""}`,
  device: "DEVICE",
  model: "Model",
  system: "System",
  browser: "Browser",
  screen: "Screen",
  screenValue: (s, v, r) => `${s} · window ${v} · pixel ratio ${r}`,
  touch: "Touch",
  orientation: "Orientation",
  installed: "Installed as app",
  theme: "Theme",
  fontSize: "Text size",
  yes: "yes",
  no: "no",
  analysis: "Technical analysis (AI)",
  verdict: { good: "On plan", fair: "Moderate deviations", poor: "Large deviations" },
  aiNote: "AI-generated from the figures above only; it may contain inaccuracies.",
  footer: "Sent at the request of the app user. No reply is needed.",
  orientations: { portrait: "portrait", landscape: "landscape", unknown: "unknown" },
  themes: { light: "light", dark: "dark" },
};

const esES: Labels = {
  app: "Planificador de Rutas",
  subject: (v) => `Estadísticas del viaje · Planificador de Rutas ${v}`,
  intro: "Estadísticas anónimas de un viaje del Planificador de Rutas.",
  privacy: "No contiene ubicación, nombres de lugares ni datos personales.",
  version: "Versión de la app",
  language: "Idioma",
  trip: "VIAJE",
  details: "DETALLES",
  metric: "Indicador",
  planned: "Previsto",
  actual: "Real",
  diff: "Diferencia",
  time: "Tiempo",
  distance: "Distancia",
  timeLine: (p, a) => `Tiempo: previsto ${p} · real ${a}`,
  distanceLine: (p, a) => `Distancia: prevista ${p} · recorrida ${a}`,
  stops: "Paradas",
  stopsValue: (d, p) => `${d} completadas de ${p}`,
  roundTrip: "Ida y vuelta",
  hasEnd: "Con destino final",
  stopped: "Tiempo parado",
  avgSpeed: "Velocidad media en movimiento",
  pauseButton: "Botón pausar",
  timesValue: (n, m) => `${n} vez/veces, ${m}`,
  longStill: "Parado más de 5 min en el mismo sitio sin pausar",
  restBreaks: "Pausas de descanso planificadas",
  reroutes: "Recálculos por salir de la ruta",
  headingUp: "Mapa girando con el viaje",
  gpsAccuracy: "Precisión media del GPS",
  legs: "TRAMOS",
  legsHeader: "TRAMOS (previsto · real)",
  leg: "Tramo",
  drive: "Conducción",
  dwell: "Estancia",
  withBreak: "con pausa de descanso",
  legLine: (i, dr, di, dw, r) => `${i}. conducción ${dr}; distancia ${di}; estancia ${dw}${r ? "; con pausa de descanso" : ""}`,
  device: "DISPOSITIVO",
  model: "Modelo",
  system: "Sistema",
  browser: "Navegador",
  screen: "Pantalla",
  screenValue: (s, v, r) => `${s} · ventana ${v} · densidad ${r}`,
  touch: "Táctil",
  orientation: "Orientación",
  installed: "Instalada como app",
  theme: "Tema",
  fontSize: "Tamaño del texto",
  yes: "sí",
  no: "no",
  analysis: "Análisis técnico (IA)",
  verdict: { good: "Según lo previsto", fair: "Desvíos moderados", poor: "Desvíos grandes" },
  aiNote: "Texto generado por IA solo a partir de las cifras anteriores; puede contener imprecisiones.",
  footer: "Enviado a petición de quien usó la app. No hace falta responder.",
  orientations: { portrait: "vertical", landscape: "horizontal", unknown: "desconocida" },
  themes: { light: "claro", dark: "oscuro" },
};

const LABELS: Record<Locale, Labels> = { "pt-BR": ptBR, "pt-PT": ptPT, "en-GB": enGB, "es-ES": esES };
const labelsOf = (locale: Locale) => LABELS[locale] ?? ptBR;

export const reportSubject = (r: TripReport) => labelsOf(r.locale).subject(r.appVersion);

const dash = "-";
const min = (s: number | null) => (s === null ? dash : `${Math.round(s / 60)} min`);
const km = (m: number | null) => (m === null ? dash : `${(m / 1000).toFixed(1)} km`);

/** Corpo em texto puro, no idioma do app (também é a prévia mostrada antes de enviar). */
export function reportText(r: TripReport, analysis: TripAnalysis | null = null): string {
  const L = labelsOf(r.locale);
  const t = r.trip;
  const d = r.device;
  const yn = (v: boolean) => (v ? L.yes : L.no);
  const lines = [
    L.intro,
    L.privacy,
    "",
    `${L.version}: ${r.appVersion}`,
    `${L.language}: ${r.locale}`,
    "",
    L.trip,
    L.timeLine(min(t.plannedSeconds), min(t.actualSeconds)),
    L.distanceLine(km(t.plannedMeters), km(t.actualMeters)),
    `${L.stops}: ${L.stopsValue(t.stopsDone, t.stopsPlanned)}`,
    `${L.roundTrip}: ${yn(t.roundTrip)} · ${L.hasEnd.toLowerCase()}: ${yn(t.hasEnd)}`,
    `${L.stopped}: ${min(t.stoppedSeconds)}`,
    `${L.avgSpeed}: ${t.averageKmh === null ? dash : `${t.averageKmh.toFixed(0)} km/h`}`,
    `${L.pauseButton}: ${L.timesValue(t.pausesUsed, min(t.pausedSeconds))}`,
    `${L.longStill}: ${L.timesValue(t.longStillCount, min(t.longStillSeconds))}`,
    `${L.restBreaks}: ${t.restBreaks} (${t.restBreakMinutes} min)`,
    `${L.reroutes}: ${t.reroutes}`,
    `${L.headingUp}: ${yn(t.headingUp)}`,
    `${L.gpsAccuracy}: ${t.averageGpsAccuracyM === null ? dash : `${Math.round(t.averageGpsAccuracyM)} m`}`,
    "",
    L.legsHeader,
    ...t.legs.map((leg, i) =>
      L.legLine(
        i + 1,
        `${min(leg.plannedSeconds)} · ${min(leg.actualSeconds)}`,
        km(leg.plannedMeters),
        `${min(leg.plannedDwellSeconds)} · ${min(leg.actualDwellSeconds)}`,
        leg.restBreak,
      ),
    ),
    "",
    L.device,
    `${L.model}: ${d.model || dash}`,
    `${L.system}: ${d.platform || dash}`,
    `${L.browser}: ${d.browser || dash}`,
    `${L.screen}: ${L.screenValue(d.screen, d.viewport, d.pixelRatio)}`,
    `${L.touch}: ${yn(d.touch)} · ${L.orientation.toLowerCase()}: ${L.orientations[d.orientation]} · ${L.installed.toLowerCase()}: ${yn(d.standalone)}`,
    `${L.theme}: ${L.themes[d.theme]} · ${L.fontSize.toLowerCase()}: ${d.fontSize}`,
  ];
  if (analysis) {
    lines.push("", L.analysis.toUpperCase(), `${L.verdict[analysis.verdict]}. ${analysis.summary}`);
    for (const f of analysis.findings) lines.push(`- ${f.title}: ${f.detail}`);
    lines.push(L.aiNote);
  }
  return lines.join("\n");
}

// ---------- HTML ----------

/** Escapa tudo que vai para o HTML (texto e atributos). */
export const esc = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const C = {
  brand: "#2456d6",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  soft: "#f8fafc",
  good: "#15803d",
  goodBg: "#dcfce7",
  warn: "#b45309",
  warnBg: "#fef3c7",
  bad: "#b91c1c",
  badBg: "#fee2e2",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

type Tone = "good" | "warn" | "bad" | "neutral";
const toneColor = (t: Tone) => (t === "neutral" ? C.ink : C[t]);
const toneBg = (t: Tone) => (t === "neutral" ? C.soft : C[`${t}Bg` as const]);

/** Desvio do real em relação ao previsto: até 10% verde, até 25% âmbar, acima vermelho. */
export function deviation(planned: number | null, actual: number | null, fasterIsGood = true): { pct: number; tone: Tone } | null {
  if (planned === null || actual === null || planned <= 0) return null;
  const pct = (actual - planned) / planned;
  if (fasterIsGood && pct < 0) return { pct, tone: "good" };
  const a = Math.abs(pct);
  return { pct, tone: a <= 0.1 ? "good" : a <= 0.25 ? "warn" : "bad" };
}

const pill = (text: string, tone: Tone) =>
  `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${toneBg(tone)};color:${toneColor(tone)};font-weight:700;font-size:14px;white-space:nowrap">${esc(text)}</span>`;

const diffCell = (planned: number | null, actual: number | null, fasterIsGood = true) => {
  const dev = deviation(planned, actual, fasterIsGood);
  if (!dev) return `<span style="color:${C.muted}">${dash}</span>`;
  const sign = dev.pct > 0 ? "+" : dev.pct < 0 ? "−" : "";
  return pill(`${sign}${Math.abs(dev.pct * 100).toFixed(0)}%`, dev.tone);
};

const th = (text: string, align = "left") =>
  `<th class="c h" style="padding:10px 12px;text-align:${align};font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:${C.muted};border-bottom:2px solid ${C.line};font-weight:700">${esc(text)}</th>`;
const td = (html: string, align = "left", strong = false) =>
  `<td class="c" style="padding:11px 12px;text-align:${align};border-bottom:1px solid ${C.line};font-size:16px;color:${C.ink};${strong ? "font-weight:700;" : ""}">${html}</td>`;

const section = (title: string, body: string) =>
  `<tr><td class="px" style="padding:24px 28px 4px"><h2 style="margin:0 0 12px;font-size:15px;letter-spacing:.06em;color:${C.brand};font-family:${FONT}">${esc(title)}</h2>${body}</td></tr>`;
const table = (head: string, rows: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:${FONT}">${head ? `<tr>${head}</tr>` : ""}${rows}</table>`;
const arrow = (p: number | null, a: number | null) =>
  `<span style="white-space:nowrap">${esc(min(p))}</span> → <b style="white-space:nowrap">${esc(min(a))}</b>`;
const kv = (label: string, valueHtml: string) => `<tr>${td(esc(label))}${td(valueHtml, "right", true)}</tr>`;

/** Versão em HTML: cabeçalho com logo, tabelas e valores coloridos. Só estilos inline (compatível com clientes de e-mail). */
export function reportHtml(r: TripReport, analysis: TripAnalysis | null, logoUrl: string): string {
  const L = labelsOf(r.locale);
  const t = r.trip;
  const d = r.device;
  const yn = (v: boolean) => esc(v ? L.yes : L.no);
  const count = (n: number, tone: Tone = "neutral") => (n > 0 && tone !== "neutral" ? pill(String(n), tone) : esc(n));

  const main = table(
    `${th(L.metric)}${th(L.planned, "right")}${th(L.actual, "right")}${th(L.diff, "right")}`,
    `<tr>${td(esc(L.time))}${td(esc(min(t.plannedSeconds)), "right")}${td(esc(min(t.actualSeconds)), "right", true)}${td(diffCell(t.plannedSeconds, t.actualSeconds), "right")}</tr>` +
      `<tr>${td(esc(L.distance))}${td(esc(km(t.plannedMeters)), "right")}${td(esc(km(t.actualMeters)), "right", true)}${td(diffCell(t.plannedMeters, t.actualMeters, false), "right")}</tr>` +
      `<tr>${td(esc(L.stops))}${td(esc(t.stopsPlanned), "right")}${td(esc(t.stopsDone), "right", true)}${td(pill(`${t.stopsDone}/${t.stopsPlanned}`, t.stopsDone >= t.stopsPlanned ? "good" : "warn"), "right")}</tr>`,
  );

  const details = table(
    "",
    kv(L.stopped, esc(min(t.stoppedSeconds))) +
      kv(L.avgSpeed, esc(t.averageKmh === null ? dash : `${t.averageKmh.toFixed(0)} km/h`)) +
      kv(L.pauseButton, esc(L.timesValue(t.pausesUsed, min(t.pausedSeconds)))) +
      kv(L.longStill, t.longStillCount > 0 ? pill(L.timesValue(t.longStillCount, min(t.longStillSeconds)), "warn") : esc(L.timesValue(0, min(0)))) +
      kv(L.restBreaks, esc(`${t.restBreaks} (${t.restBreakMinutes} min)`)) +
      kv(L.reroutes, count(t.reroutes, t.reroutes >= 3 ? "bad" : "warn")) +
      kv(L.roundTrip, yn(t.roundTrip)) +
      kv(L.hasEnd, yn(t.hasEnd)) +
      kv(L.headingUp, yn(t.headingUp)) +
      kv(
        L.gpsAccuracy,
        t.averageGpsAccuracyM === null
          ? dash
          : pill(`${Math.round(t.averageGpsAccuracyM)} m`, t.averageGpsAccuracyM <= 20 ? "good" : t.averageGpsAccuracyM <= 50 ? "warn" : "bad"),
      ),
  );

  const legs = t.legs.length
    ? table(
        `${th(L.leg)}${th(L.drive, "right")}${th(L.diff, "right")}${th(L.dwell, "right")}`,
        t.legs
          .map(
            (leg, i) =>
              `<tr>${td(`<b>${i + 1}</b> <span style="font-size:13px;color:${C.muted};white-space:nowrap">· ${esc(km(leg.plannedMeters))}</span>${leg.restBreak ? `<br><span style="font-size:13px;color:${C.muted}">☕ ${esc(L.withBreak)}</span>` : ""}`)}` +
              td(arrow(leg.plannedSeconds, leg.actualSeconds), "right") +
              td(diffCell(leg.plannedSeconds, leg.actualSeconds), "right") +
              td(arrow(leg.plannedDwellSeconds, leg.actualDwellSeconds), "right") +
              `</tr>`,
          )
          .join(""),
      )
    : "";

  const device = table(
    "",
    kv(L.model, esc(d.model || dash)) +
      kv(L.system, esc(d.platform || dash)) +
      kv(L.browser, esc(d.browser || dash)) +
      kv(L.screen, esc(L.screenValue(d.screen, d.viewport, d.pixelRatio))) +
      kv(L.touch, yn(d.touch)) +
      kv(L.orientation, esc(L.orientations[d.orientation])) +
      kv(L.installed, yn(d.standalone)) +
      kv(L.theme, esc(L.themes[d.theme])) +
      kv(L.fontSize, esc(d.fontSize)) +
      kv(L.version, esc(r.appVersion)) +
      kv(L.language, esc(r.locale)),
  );

  const verdictTone: Record<TripAnalysis["verdict"], Tone> = { good: "good", fair: "warn", poor: "bad" };
  const ai = analysis
    ? `<div style="border:1px solid ${C.line};border-radius:14px;padding:18px 18px 8px;background:${C.soft}">` +
      `<div style="margin-bottom:10px">${pill(L.verdict[analysis.verdict], verdictTone[analysis.verdict])}</div>` +
      `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${C.ink}">${esc(analysis.summary)}</p>` +
      analysis.findings
        .map(
          (f) =>
            `<div style="margin:0 0 12px;padding:10px 14px;border-left:4px solid ${toneColor(f.level)};background:#fff;border-radius:8px">` +
            `<div style="font-weight:700;font-size:15px;color:${toneColor(f.level)};margin-bottom:4px">${esc(f.title)}</div>` +
            `<div style="font-size:15px;line-height:1.55;color:${C.ink}">${esc(f.detail)}</div></div>`,
        )
        .join("") +
      `<p style="margin:6px 0 10px;font-size:12px;color:${C.muted}">${esc(L.aiNote)}</p></div>`
    : "";

  return `<!doctype html><html lang="${esc(r.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><style>@media (max-width:600px){.px{padding-left:16px!important;padding-right:16px!important}.c{padding:9px 6px!important;font-size:14px!important}.h{font-size:11px!important;letter-spacing:0!important}.wrap{padding:12px 6px!important}}</style><title>${esc(L.subject(r.appVersion))}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7"><tr><td class="wrap" align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${C.line}">
<tr><td class="px" style="background:${C.brand};padding:22px 28px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:14px"><img src="${esc(logoUrl)}" width="52" height="52" alt="" style="display:block;border-radius:13px;border:2px solid rgba(255,255,255,.35)"></td>
<td><div style="font-size:22px;font-weight:800;color:#ffffff;font-family:${FONT}">${esc(L.app)}</div>
<div style="font-size:14px;color:#dbe6ff;font-family:${FONT}">${esc(L.intro)}</div></td>
</tr></table></td></tr>
<tr><td class="px" style="padding:16px 28px 0;font-size:14px;color:${C.muted};font-family:${FONT}">🔒 ${esc(L.privacy)}</td></tr>
${section(L.trip, main)}
${ai ? section(L.analysis.toUpperCase(), ai) : ""}
${section(L.details, details)}
${legs ? section(L.legs, legs) : ""}
${section(L.device, device)}
<tr><td class="px" style="padding:22px 28px 26px;font-size:13px;color:${C.muted};font-family:${FONT}">${esc(L.footer)} · v${esc(r.appVersion)}</td></tr>
</table></td></tr></table></body></html>`;
}
