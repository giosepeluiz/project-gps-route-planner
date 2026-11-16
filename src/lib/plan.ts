import { estimateSeconds } from "./geo";
import type { LegTimeFn, Place, Plan, PlanLeg, TimeMode } from "./types";

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
 * No modo "Chegar até", a saída é a chegada menos a duração total.
 */
export function computePlan(
  sequence: readonly Place[],
  mode: TimeMode,
  at: Date,
  legTime: LegTimeFn,
): Plan {
  const times = sequence.slice(1).map((to, i) => legTime(sequence[i], to));
  const totalSeconds = times.reduce((sum, t) => sum + t.seconds, 0);
  const departAt = mode === "depart" ? at : new Date(at.getTime() - totalSeconds * 1000);

  let clock = departAt.getTime();
  const legs: PlanLeg[] = times.map((t, i) => {
    clock += t.seconds * 1000;
    return {
      from: sequence[i],
      to: sequence[i + 1],
      seconds: t.seconds,
      arriveAt: new Date(clock),
      estimated: t.estimated,
    };
  });

  return {
    legs,
    totalSeconds,
    departAt,
    arriveAt: new Date(clock),
    hasEstimates: times.some((t) => t.estimated),
  };
}
