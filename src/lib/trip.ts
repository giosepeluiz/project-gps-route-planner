/**
 * Acompanhamento da viagem pelo GPS: qual é o próximo destino, quando a pessoa
 * chegou e quando vale recalcular a rota a partir da posição atual. Tudo puro,
 * para testar sem navegador.
 */
import { haversineMeters } from "./geo";
import type { Locks } from "./locks";
import type { Place } from "./types";

export type TripStatus = "running" | "paused" | "arrived" | "finished";

/** Leitura do GPS. */
export interface Fix {
  lat: number;
  lng: number;
  /** Raio de incerteza, em metros. */
  accuracy: number;
  /** Momento da leitura (ms desde 1970). */
  at: number;
}

/** Distância até o destino que conta como "cheguei". */
export const ARRIVAL_RADIUS_M = 80;
/** Com GPS impreciso, o raio de chegada cresce até este limite. */
export const MAX_ARRIVAL_RADIUS_M = 150;
/** Intervalo mínimo entre dois recálculos da rota (poupa a cota dos serviços). */
export const REPLAN_MIN_MS = 120_000;
/** Deslocamento mínimo para recalcular depois do intervalo. */
export const REPLAN_MIN_MOVE_M = 250;
/** Deslocamento que força um recálculo mesmo antes do intervalo. */
export const REPLAN_FORCE_MOVE_M = 3_000;

/**
 * Próximo destino da viagem: a primeira parada ainda não concluída; com todas
 * feitas, o ponto final (o próprio início em ida e volta). null = nada mais a fazer.
 */
export function tripTarget(
  stops: readonly Place[],
  doneIds: ReadonlySet<string>,
  finalPlace: Place | null,
): Place | null {
  return stops.find((s) => !doneIds.has(s.id)) ?? finalPlace;
}

/** true quando a leitura do GPS está dentro do raio de chegada do destino. */
export function hasArrived(fix: Fix, target: { lat: number; lng: number }): boolean {
  const radius = Math.min(Math.max(ARRIVAL_RADIUS_M, fix.accuracy), MAX_ARRIVAL_RADIUS_M);
  return haversineMeters(fix, target) <= radius;
}

/** true quando vale recalcular a rota a partir desta leitura. */
export function shouldReplan(last: Fix | null, fix: Fix): boolean {
  if (!last) return true;
  const moved = haversineMeters(last, fix);
  if (moved >= REPLAN_FORCE_MOVE_M) return true;
  return fix.at - last.at >= REPLAN_MIN_MS && moved >= REPLAN_MIN_MOVE_M;
}

/**
 * Rota que falta, saindo da posição atual: as paradas pendentes na ordem já
 * combinada (todas travadas, para a ordem não mudar no meio da viagem) e o fim.
 */
export function remainingRoute(here: Place, pending: readonly Place[], finalPlace: Place | null) {
  const locks: Locks = Object.fromEntries(pending.map((s, i) => [s.id, i]));
  return { start: here, stops: [...pending], end: finalPlace, endSame: false, locks };
}

/**
 * Distância total da rota, em metros. Usa a distância pelas ruas quando o
 * provedor a devolveu; senão estima (linha reta × 1.4) e marca como estimativa.
 */
export function routeMeters(
  sequence: readonly { lat: number; lng: number }[],
  streetLegs: readonly { meters: number }[] | null | undefined,
): { meters: number; estimated: boolean } {
  if (streetLegs && streetLegs.length === sequence.length - 1 && streetLegs.every((l) => Number.isFinite(l.meters))) {
    return { meters: streetLegs.reduce((sum, leg) => sum + leg.meters, 0), estimated: false };
  }
  let meters = 0;
  for (let i = 1; i < sequence.length; i++) meters += haversineMeters(sequence[i - 1], sequence[i]) * 1.4;
  return { meters: Math.round(meters), estimated: true };
}
