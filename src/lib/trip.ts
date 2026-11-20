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
  /** Direção do carro (graus), quando se sabe. */
  heading?: number | null;
}

/** Distância até o destino que conta como "cheguei". */
export const ARRIVAL_RADIUS_M = 30;
/** Com GPS impreciso, o raio de chegada cresce até este limite. */
export const MAX_ARRIVAL_RADIUS_M = 60;
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

/**
 * Passou pelo destino sem entrar no raio (GPS ruim, ponto do outro lado da
 * rua): chegou perto (até PASS_NEAR_M) e agora já se afasta do ponto mais próximo.
 */
export const PASS_NEAR_M = 70;
export const PASS_AWAY_M = 20;
export function hasPassed(closestM: number, nowM: number): boolean {
  return closestM <= PASS_NEAR_M && nowM >= closestM + PASS_AWAY_M;
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

// ---------- Desvio de rota e direção ----------

/** Raio em que a posição "gruda" na linha da rota (cresce com GPS impreciso). */
export const SNAP_RADIUS_M = 45;
export const MAX_SNAP_RADIUS_M = 90;
/** Longe da linha mais do que isso, o carro saiu da rota. */
export const OFF_ROUTE_M = 60;
export const MAX_OFF_ROUTE_M = 150;
/** Leituras seguidas fora da rota antes de recalcular (evita alarme por um salto do GPS). */
export const OFF_ROUTE_FIXES = 2;
/** Intervalo mínimo entre recálculos por desvio. */
export const REROUTE_MIN_MS = 15_000;

export function snapRadius(accuracy: number): number {
  return Math.min(Math.max(SNAP_RADIUS_M, accuracy * 1.2), MAX_SNAP_RADIUS_M);
}

export function isOffRoute(distanceFromLineM: number, accuracy: number): boolean {
  return distanceFromLineM > Math.min(Math.max(OFF_ROUTE_M, accuracy * 1.5), MAX_OFF_ROUTE_M);
}

/** Recálculo por desvio: logo, mas não mais de um a cada REROUTE_MIN_MS. */
export function shouldReroute(last: Fix | null, fix: Fix, offRouteFixes: number): boolean {
  if (offRouteFixes < OFF_ROUTE_FIXES) return false;
  return !last || fix.at - last.at >= REROUTE_MIN_MS;
}

/**
 * Direção do carro: a do GPS quando ele está andando (o GPS só sabe a direção
 * em movimento); senão, a do deslocamento desde a leitura anterior; senão, null.
 */
export function headingFrom(
  previous: Fix | null,
  fix: Fix,
  gps: { heading: number | null; speed: number | null },
): number | null {
  if (gps.heading !== null && Number.isFinite(gps.heading) && (gps.speed ?? 0) > 1.5) return gps.heading;
  if (previous && haversineMeters(previous, fix) >= Math.max(8, fix.accuracy * 0.5)) {
    const rad = Math.PI / 180;
    const φ1 = previous.lat * rad;
    const φ2 = fix.lat * rad;
    const Δλ = (fix.lng - previous.lng) * rad;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }
  return null;
}

// ---------- Estatísticas da viagem ----------

/** O que estava previsto no começo da viagem. */
export interface TripBaseline {
  seconds: number;
  /** Chegada prevista ao fim (ms). */
  arriveAt: number;
  meters: number;
}

/** Diário da viagem, atualizado a cada leitura do GPS. */
export interface TripLog {
  startedAt: number;
  /** Metros percorridos (soma das leituras, sem o tremido do GPS parado). */
  meters: number;
  /** Tempo parado (pausas e paradas), em ms. */
  stoppedMs: number;
  /** Início da pausa atual, ou null se está andando. */
  stoppedSince: number | null;
  /** Última leitura que entrou na soma. */
  lastCounted: Fix | null;
}

export function newTripLog(at: number): TripLog {
  return { startedAt: at, meters: 0, stoppedMs: 0, stoppedSince: null, lastCounted: null };
}

/** Soma o deslocamento só quando ele passa da incerteza do GPS (parado, o GPS "anda" sozinho). */
export function logFix(log: TripLog, fix: Fix): TripLog {
  if (!log.lastCounted) return { ...log, lastCounted: fix };
  const moved = haversineMeters(log.lastCounted, fix);
  if (moved < Math.max(10, Math.min(fix.accuracy, 30))) return log;
  return { ...log, meters: log.meters + moved, lastCounted: fix };
}

export function logStop(log: TripLog, at: number): TripLog {
  return log.stoppedSince === null ? { ...log, stoppedSince: at } : log;
}

export function logGo(log: TripLog, at: number): TripLog {
  if (log.stoppedSince === null) return log;
  // Depois de parado, a próxima leitura recomeça a soma (sem contar um "salto").
  return { ...log, stoppedMs: log.stoppedMs + (at - log.stoppedSince), stoppedSince: null, lastCounted: null };
}

export interface TripSummary {
  plannedSeconds: number | null;
  actualSeconds: number;
  plannedArriveAt: number | null;
  arrivedAt: number;
  plannedMeters: number | null;
  actualMeters: number;
  stoppedSeconds: number;
  /** Velocidade média em movimento (km/h), ou null se quase não andou. */
  averageKmh: number | null;
  stopsDone: number;
}

export function summarizeTrip(
  log: TripLog,
  baseline: TripBaseline | null,
  finishedAt: number,
  stopsDone: number,
): TripSummary {
  const closed = logGo(log, finishedAt);
  const actualSeconds = Math.max(0, Math.round((finishedAt - log.startedAt) / 1000));
  const stoppedSeconds = Math.round(closed.stoppedMs / 1000);
  const movingSeconds = actualSeconds - stoppedSeconds;
  return {
    plannedSeconds: baseline?.seconds ?? null,
    actualSeconds,
    plannedArriveAt: baseline?.arriveAt ?? null,
    arrivedAt: finishedAt,
    plannedMeters: baseline?.meters ?? null,
    actualMeters: Math.round(closed.meters),
    stoppedSeconds,
    averageKmh: movingSeconds >= 60 && closed.meters >= 200 ? (closed.meters / movingSeconds) * 3.6 : null,
    stopsDone,
  };
}
