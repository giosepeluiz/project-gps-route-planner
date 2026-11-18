/**
 * Registro da viagem para as estatísticas anônimas: tempo de cada trecho e de
 * cada parada, pausas, paradas longas sem pausar, recálculos e precisão do GPS.
 * Só números; nenhuma posição sai daqui.
 */
import { haversineMeters } from "./geo";
import type { Fix, TripSummary } from "./trip";
import type { TripReport } from "./trip-report";

/** Parado mais que isso no mesmo lugar (sem pausar) conta como "parada longa". */
export const LONG_STILL_MS = 5 * 60_000;
/** Raio que ainda conta como "o mesmo lugar". */
export const STILL_RADIUS_M = 40;

export interface PlannedLeg {
  seconds: number;
  meters: number | null;
  dwellSeconds: number;
  restBreak: boolean;
}

export interface TripTrack {
  legStartedAt: number;
  arrivedAt: number | null;
  legs: { actualSeconds: number | null; actualDwellSeconds: number | null }[];
  pauses: number;
  pausedMs: number;
  pauseSince: number | null;
  /** Lugar onde o carro está parado agora (sem posição guardada depois da viagem). */
  still: { lat: number; lng: number; since: number; last: number; counted: boolean } | null;
  longStillCount: number;
  longStillMs: number;
  reroutes: number;
  accuracySum: number;
  accuracyCount: number;
}

export function newTrack(at: number): TripTrack {
  return {
    legStartedAt: at,
    arrivedAt: null,
    legs: [],
    pauses: 0,
    pausedMs: 0,
    pauseSince: null,
    still: null,
    longStillCount: 0,
    longStillMs: 0,
    reroutes: 0,
    accuracySum: 0,
    accuracyCount: 0,
  };
}

/** Fecha o período parado atual: se passou do limite, soma o tempo. */
function closeStill(track: TripTrack): TripTrack {
  if (!track.still) return track;
  return track.still.counted
    ? { ...track, still: null, longStillMs: track.longStillMs + (track.still.last - track.still.since) }
    : { ...track, still: null };
}

export function trackFix(track: TripTrack, fix: Fix): TripTrack {
  let next: TripTrack = {
    ...track,
    accuracySum: track.accuracySum + fix.accuracy,
    accuracyCount: track.accuracyCount + 1,
  };
  const still = next.still;
  if (still && haversineMeters(still, fix) <= Math.max(STILL_RADIUS_M, fix.accuracy)) {
    const counted = still.counted || fix.at - still.since >= LONG_STILL_MS;
    next = {
      ...next,
      still: { ...still, last: fix.at, counted },
      longStillCount: next.longStillCount + (counted && !still.counted ? 1 : 0),
    };
  } else {
    next = closeStill(next);
    next = { ...next, still: { lat: fix.lat, lng: fix.lng, since: fix.at, last: fix.at, counted: false } };
  }
  return next;
}

/** Chegou numa parada (ou no fim): fecha o tempo de direção do trecho. */
export function trackArrive(track: TripTrack, at: number): TripTrack {
  const legs = [...track.legs, { actualSeconds: Math.round((at - track.legStartedAt) / 1000), actualDwellSeconds: null }];
  return { ...closeStill(track), legs, arrivedAt: at };
}

/** Saiu da parada: fecha o tempo de permanência e começa o próximo trecho. */
export function trackLeave(track: TripTrack, at: number): TripTrack {
  if (track.arrivedAt === null || track.legs.length === 0) return { ...track, legStartedAt: at };
  const legs = [...track.legs];
  legs[legs.length - 1] = { ...legs[legs.length - 1], actualDwellSeconds: Math.round((at - track.arrivedAt) / 1000) };
  return { ...track, legs, arrivedAt: null, legStartedAt: at, still: null };
}

export function trackPause(track: TripTrack, at: number): TripTrack {
  return track.pauseSince === null ? { ...closeStill(track), pauses: track.pauses + 1, pauseSince: at } : track;
}

export function trackResume(track: TripTrack, at: number): TripTrack {
  return track.pauseSince === null ? track : { ...track, pausedMs: track.pausedMs + (at - track.pauseSince), pauseSince: null };
}

export function trackReroute(track: TripTrack): TripTrack {
  return { ...track, reroutes: track.reroutes + 1 };
}

/** Parte "viagem" do relatório anônimo. */
export function tripReportOf(
  track: TripTrack,
  summary: TripSummary,
  planned: readonly PlannedLeg[],
  extra: {
    stopsPlanned: number;
    roundTrip: boolean;
    hasEnd: boolean;
    restBreaks: number;
    restBreakMinutes: number;
    headingUp: boolean;
  },
  finishedAt: number,
): TripReport["trip"] {
  const closed = trackResume(closeStill(track), finishedAt);
  const count = Math.max(planned.length, closed.legs.length);
  const round = (n: number) => Math.max(0, Math.round(n));
  return {
    plannedSeconds: summary.plannedSeconds,
    actualSeconds: summary.actualSeconds,
    plannedMeters: summary.plannedMeters,
    actualMeters: summary.actualMeters,
    stoppedSeconds: summary.stoppedSeconds,
    averageKmh: summary.averageKmh === null ? null : Math.min(400, summary.averageKmh),
    stopsPlanned: extra.stopsPlanned,
    stopsDone: summary.stopsDone,
    roundTrip: extra.roundTrip,
    hasEnd: extra.hasEnd,
    pausesUsed: closed.pauses,
    pausedSeconds: round(closed.pausedMs / 1000),
    longStillCount: closed.longStillCount,
    longStillSeconds: round(closed.longStillMs / 1000),
    restBreaks: extra.restBreaks,
    restBreakMinutes: extra.restBreakMinutes,
    reroutes: closed.reroutes,
    headingUp: extra.headingUp,
    averageGpsAccuracyM: closed.accuracyCount > 0 ? closed.accuracySum / closed.accuracyCount : null,
    legs: Array.from({ length: Math.min(count, 50) }, (_, i) => ({
      plannedSeconds: planned[i] ? round(planned[i].seconds) : null,
      actualSeconds: closed.legs[i]?.actualSeconds ?? null,
      plannedMeters: planned[i]?.meters == null ? null : round(planned[i].meters!),
      plannedDwellSeconds: planned[i] ? round(planned[i].dwellSeconds) : null,
      actualDwellSeconds: closed.legs[i]?.actualDwellSeconds ?? null,
      restBreak: planned[i]?.restBreak ?? false,
    })),
  };
}
