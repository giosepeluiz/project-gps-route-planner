import { estimateSeconds } from "./geo";
import { MAX_DWELL_MINUTES, type LegTimeFn, type Place, type Plan, type PlanLeg, type TimeMode } from "./types";

/** Permanência de um local em segundos (valores inválidos viram 0). */
export function dwellSecondsOf(place: Pick<Place, "dwellMinutes">): number {
  const minutes = Number(place.dwellMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(Math.min(minutes, MAX_DWELL_MINUTES)) * 60;
}

/** Último recurso, usado no navegador enquanto o servidor não responde. */
export const estimateLegTime: LegTimeFn = (from, to) =>
  from.id === to.id
    ? { seconds: 0, estimated: false }
    : { seconds: estimateSeconds(from, to), estimated: true };

/** Soma os tempos de uma sequência de locais (início, paradas e fim). */
export function sequenceSeconds(sequence: readonly Place[], legTime: LegTimeFn): number {
  let total = 0;
  for (let i = 1; i < sequence.length; i++) {
    total += legTime(sequence[i - 1], sequence[i]).seconds;
  }
  return total;
}

/**
 * Monta os horários de uma sequência já ordenada.
 * Cada parada intermediária soma a sua permanência; no último local a rota
 * termina, então a permanência dele não conta.
 * No modo "Chegar até", a saída é a chegada menos a duração total.
 */
export function computePlan(
  sequence: readonly Place[],
  mode: TimeMode,
  at: Date,
  legTime: LegTimeFn,
): Plan {
  const times = sequence.slice(1).map((to, i) => legTime(sequence[i], to));
  const dwells = sequence.map((place, i) => (i === 0 || i === sequence.length - 1 ? 0 : dwellSecondsOf(place)));
  const driveSeconds = times.reduce((sum, t) => sum + t.seconds, 0);
  const dwellSeconds = dwells.reduce((sum, s) => sum + s, 0);
  const totalSeconds = driveSeconds + dwellSeconds;
  const departAt = mode === "depart" ? at : new Date(at.getTime() - totalSeconds * 1000);

  let clock = departAt.getTime();
  const legs: PlanLeg[] = times.map((t, i) => {
    clock += t.seconds * 1000;
    const arriveAt = new Date(clock);
    const dwell = dwells[i + 1];
    clock += dwell * 1000;
    return {
      from: sequence[i],
      to: sequence[i + 1],
      seconds: t.seconds,
      arriveAt,
      dwellSeconds: dwell,
      leaveAt: new Date(clock),
      estimated: t.estimated,
    };
  });

  return {
    legs,
    totalSeconds,
    driveSeconds,
    dwellSeconds,
    departAt,
    arriveAt: new Date(clock),
    hasEstimates: times.some((t) => t.estimated),
  };
}
