/**
 * Link compartilhável da rota. Só leva coordenadas, tempos e pausas: nenhum
 * nome ou texto livre viaja no link (os nomes são buscados de novo por quem
 * abre), o que fecha a porta para injeção de HTML ou de texto.
 *
 * Dois formatos, ambos aceitos na leitura:
 *
 *   Caminho:    /r/<início>/<fim>/<parada1>/<parada2>/…
 *   Parâmetros: /?s=<início>&e=<fim>&p1=<parada1>&p2=<parada2>…
 *
 * - Local: "lat,lng" com ponto decimal (ex.: 38.70750,-9.13640). Permanência
 *   opcional em minutos depois de "@": 38.7,-9.1@15.
 * - Fim: "s" = volta ao início; "-" = sem fim (termina na última parada). Nos
 *   parâmetros, sem "e" também quer dizer sem fim.
 * - Pausa para descanso: "b<minutos>" no lugar de uma parada (ex.: b20).
 */
import { MAX_STOPS } from "./stops";
import { MAX_DWELL_MINUTES } from "./types";

export interface SharedPoint {
  lat: number;
  lng: number;
  dwellMinutes: number;
}

export type SharedItem = ({ kind: "stop" } & SharedPoint) | { kind: "break"; minutes: number };

export interface SharedRoute {
  start: SharedPoint;
  end: "none" | "start" | SharedPoint;
  items: SharedItem[];
}

/** Limite de itens (paradas + pausas) num link. */
const MAX_ITEMS = MAX_STOPS * 2 + 1;
const POINT = /^(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)(?:@(\d{1,3}))?$/;
const BREAK = /^b(\d{1,3})$/;

function parsePoint(token: string): SharedPoint | null {
  const m = POINT.exec(token);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const dwell = m[3] === undefined ? 0 : Number(m[3]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || dwell > MAX_DWELL_MINUTES) return null;
  return { lat, lng, dwellMinutes: dwell };
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

function parseEnd(token: string | null): SharedRoute["end"] | null {
  if (token === null || token === "-" || token === "") return "none";
  if (token === "s") return "start";
  return parsePoint(token);
}

function build(startToken: string, endToken: string | null, itemTokens: string[]): SharedRoute | null {
  if (itemTokens.length > MAX_ITEMS) return null;
  const start = parsePoint(startToken);
  const end = parseEnd(endToken);
  if (!start || !end) return null;
  const items: SharedItem[] = [];
  for (const token of itemTokens) {
    const item = parseItem(token);
    if (!item) return null;
    items.push(item);
  }
  if (items.filter((i) => i.kind === "stop").length > MAX_STOPS) return null;
  return { start, end, items };
}

/** Lê uma rota do endereço (caminho /r/… ou parâmetros). null = não há rota válida. */
export function parseSharedRoute(pathname: string, search: string): SharedRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "r" && segments.length >= 3) {
    let decoded: string[];
    try {
      decoded = segments.slice(1).map((s) => decodeURIComponent(s).trim());
    } catch {
      return null;
    }
    return build(decoded[0], decoded[1], decoded.slice(2));
  }
  const params = new URLSearchParams(search);
  const start = params.get("s");
  if (!start) return null;
  // p1, p2… (ou s1, s2…), na ordem do número.
  const numbered = [...params.entries()]
    .map(([key, value]) => ({ m: /^[ps](\d{1,2})$/.exec(key), value: value.trim() }))
    .filter((e): e is { m: RegExpExecArray; value: string } => e.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((e) => e.value);
  return build(start.trim(), params.get("e")?.trim() ?? null, numbered);
}

const fmt = (n: number) => String(Number(n.toFixed(5)));
const pointToken = (p: SharedPoint) =>
  `${fmt(p.lat)},${fmt(p.lng)}${p.dwellMinutes > 0 ? `@${Math.round(p.dwellMinutes)}` : ""}`;
const itemToken = (item: SharedItem) => (item.kind === "break" ? `b${Math.round(item.minutes)}` : pointToken(item));
const endToken = (end: SharedRoute["end"]) => (end === "none" ? "-" : end === "start" ? "s" : pointToken(end));

/** Link no formato de caminho: /r/início/fim/parada1/… */
export function sharedPath(route: SharedRoute): string {
  return `/r/${[pointToken(route.start), endToken(route.end), ...route.items.map(itemToken)].join("/")}`;
}

/** Link no formato de parâmetros: /?s=…&e=…&p1=… */
export function sharedQuery(route: SharedRoute): string {
  const params = new URLSearchParams({ s: pointToken(route.start) });
  if (route.end !== "none") params.set("e", endToken(route.end));
  route.items.forEach((item, i) => params.set(`p${i + 1}`, itemToken(item)));
  return `/?${params.toString().replace(/%2C/g, ",").replace(/%40/g, "@")}`;
}
