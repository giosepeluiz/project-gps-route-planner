/**
 * Pausas para descanso: um tempo parado no caminho, sem local próprio. Cada
 * pausa fica num trecho da visita (travada na posição) e soma o tempo dela ao
 * horário de chegada do trecho. Duas pausas não podem ficar juntas.
 */
import type { Place } from "./types";
import { MAX_DWELL_MINUTES } from "./types";

export interface RestBreak {
  id: string;
  /** Duração da pausa, em minutos. */
  minutes: number;
  /**
   * Trecho da pausa: quantas paradas vêm antes dela. 0 = entre o início e a
   * primeira parada; n = entre a última parada e o fim.
   */
  after: number;
}

/** Duração sugerida de uma pausa nova. */
export const DEFAULT_BREAK_MINUTES = 15;

export function isRestBreak(value: unknown): value is RestBreak {
  const b = value as Partial<RestBreak> | null;
  return (
    !!b &&
    typeof b.id === "string" &&
    b.id.length > 0 &&
    b.id.length <= 64 &&
    typeof b.minutes === "number" &&
    Number.isInteger(b.minutes) &&
    b.minutes >= 1 &&
    b.minutes <= MAX_DWELL_MINUTES &&
    typeof b.after === "number" &&
    Number.isInteger(b.after) &&
    b.after >= 0
  );
}

/** Quantos trechos a rota tem: um por parada, mais o trecho até o fim (se houver fim). */
export const legCountOf = (stopCount: number, hasFinal: boolean) => stopCount + (hasFinal ? 1 : 0);

/**
 * Pausas válidas para a rota atual: cada uma num trecho que existe, uma por
 * trecho (pausas que caírem no mesmo trecho, por exemplo depois de remover
 * uma parada, viram uma só, somando o tempo), em ordem.
 */
export function normalizeBreaks(breaks: readonly RestBreak[], stopCount: number, hasFinal: boolean): RestBreak[] {
  const legs = legCountOf(stopCount, hasFinal);
  if (legs === 0) return [];
  const byLeg = new Map<number, RestBreak>();
  for (const b of breaks) {
    const after = Math.min(Math.max(0, b.after), legs - 1);
    const existing = byLeg.get(after);
    byLeg.set(
      after,
      existing
        ? { ...existing, minutes: Math.min(existing.minutes + b.minutes, MAX_DWELL_MINUTES) }
        : { ...b, after },
    );
  }
  return [...byLeg.values()].sort((a, b) => a.after - b.after);
}

/** Pausa em segundos por trecho, para o cálculo dos horários. */
export function breakSecondsByLeg(breaks: readonly RestBreak[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const b of breaks) map.set(b.after, (map.get(b.after) ?? 0) + b.minutes * 60);
  return map;
}

/** Trechos livres para uma pausa nova (ou para mover a pausa `ignoreId`). */
export function freeLegs(breaks: readonly RestBreak[], legCount: number, ignoreId?: string): number[] {
  const taken = new Set(breaks.filter((b) => b.id !== ignoreId).map((b) => b.after));
  return Array.from({ length: legCount }, (_, i) => i).filter((i) => !taken.has(i));
}

/** Ao remover a parada da posição `index`, as pausas depois dela sobem um trecho. */
export function shiftBreaksAfterRemoval(breaks: readonly RestBreak[], index: number): RestBreak[] {
  return breaks.map((b) => (b.after > index ? { ...b, after: b.after - 1 } : b));
}

// ---------- Lista com paradas e pausas juntas ----------

export type Row = { kind: "stop"; stop: Place; index: number } | { kind: "break"; brk: RestBreak };

/** Paradas e pausas na ordem da visita: a pausa do trecho i vem antes da parada i. */
export function rowsOf(stops: readonly Place[], breaks: readonly RestBreak[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i <= stops.length; i++) {
    for (const b of breaks) if (b.after === i) rows.push({ kind: "break", brk: b });
    if (i < stops.length) rows.push({ kind: "stop", stop: stops[i], index: i });
  }
  return rows;
}

export type RowMove =
  | { ok: true; stopMove: { from: number; to: number } | null; breaks: RestBreak[] }
  | { ok: false; reason: "adjacent" | "edge" };

/**
 * Arrastar uma linha da lista (parada ou pausa) de `from` para `to`. As pausas
 * ficam onde estão na lista; a nova posição de cada uma é contada pelas paradas
 * antes dela. Duas pausas juntas não valem.
 */
export function moveRow(rows: readonly Row[], from: number, to: number, legCount: number): RowMove {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return { ok: true, stopMove: null, breaks: rows.flatMap((r) => (r.kind === "break" ? [r.brk] : [])) };
  }
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  const breaks: RestBreak[] = [];
  let stopsSeen = 0;
  for (const row of next) {
    if (row.kind === "stop") stopsSeen += 1;
    else breaks.push({ ...row.brk, after: stopsSeen });
  }
  const legs = new Set<number>();
  for (const b of breaks) {
    if (b.after >= legCount) return { ok: false, reason: "edge" };
    if (legs.has(b.after)) return { ok: false, reason: "adjacent" };
    legs.add(b.after);
  }

  let stopMove: { from: number; to: number } | null = null;
  if (moved.kind === "stop") {
    const newIndex = next.filter((r) => r.kind === "stop").findIndex((r) => r === moved);
    if (newIndex !== moved.index) stopMove = { from: moved.index, to: newIndex };
  }
  return { ok: true, stopMove, breaks };
}
