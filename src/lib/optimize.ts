/** Liga os locais da rota ao solver: monta a matriz e devolve as paradas reordenadas. */
import { routeCost, solveRoute, type SolveOptions } from "./solver";
import type { LegTimeFn, Place } from "./types";

export interface OptimizedStops {
  /** Paradas na melhor ordem encontrada. */
  stops: Place[];
  /** Tempo total da melhor ordem, em segundos. */
  seconds: number;
  /** Tempo total da ordem digitada, para comparação. */
  typedSeconds: number;
  /** true quando a ordem é comprovadamente a melhor (até 10 paradas). */
  exact: boolean;
}

/**
 * @param typedStops paradas na ordem digitada
 * @param end ponto final; o próprio `start` em ida e volta, ou null para terminar na última parada
 */
export function optimizeStops(
  start: Place,
  typedStops: readonly Place[],
  end: Place | null,
  legTime: LegTimeFn,
  options?: SolveOptions,
): OptimizedStops {
  // Índices: 0 = início, 1..n = paradas, n+1 = fim (quando diferente do início).
  const nodes: Place[] = [start, ...typedStops];
  let endIndex: number | null = null;
  if (end) {
    endIndex = end.id === start.id ? 0 : nodes.push(end) - 1;
  }

  // Matriz assimétrica: cada sentido é consultado separadamente.
  const matrix = nodes.map((from, i) =>
    nodes.map((to, j) => (i === j ? 0 : legTime(from, to).seconds)),
  );
  const stopIndexes = typedStops.map((_, i) => i + 1);
  const problem = { matrix, start: 0, stops: stopIndexes, end: endIndex };

  const typedSeconds = routeCost(problem, stopIndexes);
  const solution = solveRoute(problem, options);

  // Empate: fica com a ordem digitada, para a lista não mudar sem ganho.
  if (solution.cost >= typedSeconds) {
    return { stops: [...typedStops], seconds: typedSeconds, typedSeconds, exact: solution.exact };
  }
  return {
    stops: solution.order.map((index) => nodes[index]),
    seconds: solution.cost,
    typedSeconds,
    exact: solution.exact,
  };
}
