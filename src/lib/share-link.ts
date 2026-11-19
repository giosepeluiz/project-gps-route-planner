/**
 * Link compartilhável da rota. Só leva coordenadas, tempos, travas, pausas e a
 * hora: nenhum nome ou texto livre viaja no link (os nomes são buscados de novo
 * por quem abre), o que fecha a porta para injeção de HTML ou de texto.
 *
 * Dois formatos, ambos aceitos na leitura:
 *
 *   Caminho:    /r/<início>/<fim>/<parada1>/<parada2>/…[/<hora>]
 *   Parâmetros: /?s=<início>&e=<fim>&p1=<parada1>&p2=<parada2>…[&t=<hora>]
 *
 * - Local: "lat,lng" com ponto decimal (ex.: 38.70750,-9.13640). Permanência
 *   opcional em minutos depois de "@": 38.7,-9.1@15.
 * - Parada travada na posição em que aparece: "!" no fim (ex.: 38.7,-9.1@15!).
 * - Fim: "s" = volta ao início; "-" = sem fim (termina na última parada). Nos
 *   parâmetros, sem "e" também quer dizer sem fim.
 * - Pausa para descanso: "b<minutos>" no lugar de uma parada (ex.: b20).
 * - Hora: "d" (saída) ou "a" (chegada) + AAAAMMDDhhmm, hora local
 *   (ex.: d202611190830). No caminho é o último segmento; nos parâmetros, t=.
 */
import { MAX_STOPS } from "./stops";
import { MAX_DWELL_MINUTES } from "./types";

export interface SharedPoint {
  lat: number;
  lng: number;
  dwellMinutes: number;
  /** Parada travada na posição em que aparece no link. */
  locked?: boolean;
}

/** Hora escolhida: de saída ou de chegada, no formato do datetime-local (AAAA-MM-DDThh:mm). */
export interface SharedTime {
  mode: "depart" | "arrive";
  at: string;
}

export type SharedItem = ({ kind: "stop" } & SharedPoint) | { kind: "break"; minutes: number };

export interface SharedRoute {
  start: SharedPoint;
  end: "none" | "start" | SharedPoint;
  items: SharedItem[];
  time?: SharedTime | null;
}

/** Limite de itens (paradas + pausas) num link. */
const MAX_ITEMS = MAX_STOPS * 2 + 1;
const POINT = /^(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)(?:@(\d{1,3}))?(!)?$/;
const BREAK = /^b(\d{1,3})$/;
const TIME = /^([da])(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/** null = sem hora no link; undefined = hora inválida (o link inteiro é recusado). */
function parseTime(token: string | null): SharedTime | null | undefined {
  if (token === null || token === "") return null;
  const m = TIME.exec(token);
  if (!m) return undefined;
  const [, kind, y, mo, d, h, mi] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Data impossível (31/02, 25h…) não passa.
  const same =
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(mo) - 1 &&
    date.getDate() === Number(d) &&
    date.getHours() === Number(h) &&
    date.getMinutes() === Number(mi);
  if (!same) return undefined;
  return { mode: kind === "d" ? "depart" : "arrive", at: `${y}-${mo}-${d}T${h}:${mi}` };
}

function parsePoint(token: string): SharedPoint | null {
  const m = POINT.exec(token);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const dwell = m[3] === undefined ? 0 : Number(m[3]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || dwell > MAX_DWELL_MINUTES) return null;
  return { lat, lng, dwellMinutes: dwell, ...(m[4] ? { locked: true } : {}) };
}

function parseItem(token: string): SharedItem | null {
  const b = BREAK.exec(token);
  if (b) {
    const minutes = Number(b[1]);
    return minutes >= 1 && minutes <= MAX_DWELL_MINUTES ? { kind: "break", minutes } : null;
  }
  const point = parsePoint(token);
  return point ? { kind: "stop", ...point } : null;
}

/** Início e fim são fixos: a trava não se aplica a eles. */
function unlocked(point: SharedPoint | null): SharedPoint | null {
  if (!point) return null;
  const { lat, lng, dwellMinutes } = point;
  return { lat, lng, dwellMinutes };
}

function parseEnd(token: string | null): SharedRoute["end"] | null {
  if (token === null || token === "-" || token === "") return "none";
  if (token === "s") return "start";
  return unlocked(parsePoint(token));
}

function build(
  startToken: string,
  endToken: string | null,
  itemTokens: string[],
  timeToken: string | null,
): SharedRoute | null {
  // No formato de caminho, a hora vem como último segmento.
  const last = itemTokens[itemTokens.length - 1];
  if (timeToken === null && last !== undefined && TIME.test(last)) {
    timeToken = last;
    itemTokens = itemTokens.slice(0, -1);
  }
  if (itemTokens.length > MAX_ITEMS) return null;
  const start = unlocked(parsePoint(startToken));
  const end = parseEnd(endToken);
  const time = parseTime(timeToken);
  if (!start || !end || time === undefined) return null;
  const items: SharedItem[] = [];
  for (const token of itemTokens) {
    const item = parseItem(token);
    if (!item) return null;
    items.push(item);
  }
  if (items.filter((i) => i.kind === "stop").length > MAX_STOPS) return null;
  return { start, end, items, time };
}

/** Lê uma rota do endereço (caminho /r/… ou parâmetros). null = não há rota válida. */
export function parseSharedRoute(pathname: string, search: string): SharedRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  const timeParam = params.get("t")?.trim() ?? null;
  if (segments[0] === "r" && segments.length >= 3) {
    let decoded: string[];
    try {
      decoded = segments.slice(1).map((s) => decodeURIComponent(s).trim());
    } catch {
      return null;
    }
    return build(decoded[0], decoded[1], decoded.slice(2), timeParam);
  }
  const start = params.get("s");
  if (!start) return null;
  // p1, p2… (ou s1, s2…), na ordem do número.
  const numbered = [...params.entries()]
    .map(([key, value]) => ({ m: /^[ps](\d{1,2})$/.exec(key), value: value.trim() }))
    .filter((e): e is { m: RegExpExecArray; value: string } => e.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((e) => e.value);
  return build(start.trim(), params.get("e")?.trim() ?? null, numbered, timeParam);
}

const fmt = (n: number) => String(Number(n.toFixed(5)));
const pointToken = (p: SharedPoint) =>
  `${fmt(p.lat)},${fmt(p.lng)}${p.dwellMinutes > 0 ? `@${Math.round(p.dwellMinutes)}` : ""}${p.locked ? "!" : ""}`;
const itemToken = (item: SharedItem) => (item.kind === "break" ? `b${Math.round(item.minutes)}` : pointToken(item));
const endToken = (end: SharedRoute["end"]) =>
  end === "none" ? "-" : end === "start" ? "s" : pointToken(unlocked(end)!);
const timeToken = (time: SharedTime) => `${time.mode === "depart" ? "d" : "a"}${time.at.replace(/\D/g, "").slice(0, 12)}`;

/** Link no formato de caminho: /r/início/fim/parada1/…[/hora] */
export function sharedPath(route: SharedRoute): string {
  const time = route.time ? [timeToken(route.time)] : [];
  return `/r/${[pointToken(unlocked(route.start)!), endToken(route.end), ...route.items.map(itemToken), ...time].join("/")}`;
}

/** Link no formato de parâmetros: /?s=…&e=…&p1=…[&t=…] */
export function sharedQuery(route: SharedRoute): string {
  const params = new URLSearchParams({ s: pointToken(unlocked(route.start)!) });
  if (route.end !== "none") params.set("e", endToken(route.end));
  route.items.forEach((item, i) => params.set(`p${i + 1}`, itemToken(item)));
  if (route.time) params.set("t", timeToken(route.time));
  return `/?${params.toString().replace(/%2C/g, ",").replace(/%40/g, "@").replace(/%21/g, "!")}`;
}
