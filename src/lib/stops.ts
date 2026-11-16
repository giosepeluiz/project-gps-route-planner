import { haversineMeters } from "./geo";
import type { Place } from "./types";

export const MAX_STOPS = 20;
/** A partir desta quantidade de paradas a ordem passa a ser aproximada. */
export const APPROX_FROM = 11;
export const DUPLICATE_TOLERANCE_M = 20;

export const MSG_LIMIT = "Limite de 20 paradas.";
export const MSG_APPROX =
  "Com 11 ou mais paradas, a ordem é aproximada e pode não ser a melhor.";
export const MSG_DUPLICATE = "Esse local já está na rota.";
export const MSG_NOT_FOUND =
  "Não encontrei esse local. Tente mais detalhes, coordenadas ou um link.";

export type AddStopResult =
  | { ok: true; stops: Place[] }
  | { ok: false; reason: "limit" | "duplicate"; message: string };

export function isDuplicate(place: Place, others: readonly Place[]): boolean {
  return others.some((o) => haversineMeters(o, place) <= DUPLICATE_TOLERANCE_M);
}

/**
 * Adiciona uma parada respeitando o limite e ignorando duplicados.
 * `fixed` são os pontos de início e fim, que também contam como duplicados.
 */
export function addStop(
  stops: readonly Place[],
  place: Place,
  fixed: readonly Place[] = [],
): AddStopResult {
  if (stops.length >= MAX_STOPS) {
    return { ok: false, reason: "limit", message: MSG_LIMIT };
  }
  if (isDuplicate(place, [...stops, ...fixed])) {
    return { ok: false, reason: "duplicate", message: MSG_DUPLICATE };
  }
  return { ok: true, stops: [...stops, place] };
}

export function isApproximate(stopCount: number): boolean {
  return stopCount >= APPROX_FROM;
}
