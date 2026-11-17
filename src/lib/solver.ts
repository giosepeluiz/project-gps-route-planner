/**
 * Ordenação das paradas sobre uma matriz de tempos ASSIMÉTRICA (segundos).
 *
 * - Até 10 paradas: solução exata (Held-Karp com início e fim fixos).
 * - De 11 a 20: heurística (vizinho mais próximo + 2-opt + Or-opt), com
 *   limite de iterações e de tempo. A ordem é aproximada.
 *
 * A ordem NUNCA vem da IA: vem daqui.
 */

export const EXACT_MAX_STOPS = 10;

export interface RouteProblem {
  /** matrix[i][j] = segundos de i até j. */
  matrix: readonly (readonly number[])[];
  /** Índice do ponto de partida. */
  start: number;
  /** Índices das paradas, na ordem digitada. */
  stops: readonly number[];
  /** Índice do ponto final (pode ser igual a `start`, em ida e volta) ou null para terminar na última parada. */
  end: number | null;
  /**
   * Paradas travadas pelo usuário: posição na visita (0 = primeira parada) → índice da parada.
   * As demais são otimizadas em volta delas.
   */
  fixed?: ReadonlyMap<number, number>;
}

/** Posição travada de cada parada (por índice da parada), a partir de `fixed`. */
function lockedPositions(problem: Pick<RouteProblem, "stops" | "fixed">): Map<number, number> {
  const byStop = new Map<number, number>();
  problem.fixed?.forEach((stop, position) => {
    if (position >= 0 && position < problem.stops.length && problem.stops.includes(stop)) {
      byStop.set(stop, position);
    }
  });
  return byStop;
}

/** A ordem respeita todas as travas? */
export function respectsLocks(
  problem: Pick<RouteProblem, "stops" | "fixed">,
  order: readonly number[],
): boolean {
  for (const [stop, position] of lockedPositions(problem)) {
    if (order[position] !== stop) return false;
  }
  return true;
}

export interface RouteSolution {
  /** Paradas na ordem de visita. */
  order: number[];
  /** Tempo total em segundos, do início ao fim. */
  cost: number;
  /** true quando a ordem é comprovadamente a melhor. */
  exact: boolean;
}

export interface SolveOptions {
  /** Até quantas paradas usar a solução exata. */
  exactMaxStops?: number;
  maxIterations?: number;
  timeLimitMs?: number;
  now?: () => number;
}

/** Tempo total de uma ordem de visita. */
export function routeCost(problem: Omit<RouteProblem, "stops">, order: readonly number[]): number {
  const { matrix, start, end } = problem;
  let cost = 0;
  let previous = start;
  for (const stop of order) {
    cost += matrix[previous][stop];
    previous = stop;
  }
  if (end !== null) cost += matrix[previous][end];
  return cost;
}

/** Held-Karp: programação dinâmica sobre subconjuntos de paradas. */
export function solveExact(problem: RouteProblem): RouteSolution {
  const { matrix, start, stops, end } = problem;
  const n = stops.length;
  if (n === 0) return { order: [], cost: routeCost(problem, []), exact: true };

  // Travas: a parada j só entra na posição dela, e a posição travada só aceita a parada dela.
  const lockOf = lockedPositions(problem);
  const ownerOf = new Map<number, number>();
  lockOf.forEach((position, stop) => ownerOf.set(position, stop));
  const allowed = (j: number, position: number) => {
    const lock = lockOf.get(stops[j]);
    if (lock !== undefined) return lock === position;
    return !ownerOf.has(position);
  };
  const popcount = (mask: number) => {
    let count = 0;
    for (let m = mask; m; m &= m - 1) count++;
    return count;
  };

  const size = 1 << n;
  // best[mask * n + j]: menor tempo saindo do início, visitando `mask` e terminando na parada j.
  const best = new Float64Array(size * n).fill(Infinity);
  const parent = new Int8Array(size * n).fill(-1);

  for (let j = 0; j < n; j++) {
    if (allowed(j, 0)) best[(1 << j) * n + j] = matrix[start][stops[j]];
  }

  for (let mask = 1; mask < size; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const current = best[mask * n + j];
      if (current === Infinity) continue;
      const position = popcount(mask);
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        if (!allowed(k, position)) continue;
        const next = mask | (1 << k);
        const candidate = current + matrix[stops[j]][stops[k]];
        if (candidate < best[next * n + k]) {
          best[next * n + k] = candidate;
          parent[next * n + k] = j;
        }
      }
    }
  }

  const full = size - 1;
  let bestCost = Infinity;
  let last = 0;
  for (let j = 0; j < n; j++) {
    const total = best[full * n + j] + (end === null ? 0 : matrix[stops[j]][end]);
    if (total < bestCost) {
      bestCost = total;
      last = j;
    }
  }

  const order: number[] = [];
  let mask = full;
  let j = last;
  while (j !== -1) {
    order.push(stops[j]);
    const previous = parent[mask * n + j];
    mask ^= 1 << j;
    j = previous;
  }
  order.reverse();
  return { order, cost: bestCost, exact: true };
}

/** Vizinho mais próximo: sempre vai para a parada mais perto da atual. */
export function nearestNeighbor(problem: RouteProblem): number[] {
  const { matrix, start, stops } = problem;
  const lockOf = lockedPositions(problem);
  const ownerOf = new Map<number, number>();
  lockOf.forEach((position, stop) => ownerOf.set(position, stop));
  // As travadas ficam fora da escolha: entram direto na posição delas.
  const remaining = stops.filter((stop) => !lockOf.has(stop));
  const order: number[] = [];
  let current = start;
  for (let position = 0; position < stops.length; position++) {
    const owner = ownerOf.get(position);
    if (owner !== undefined) {
      current = owner;
    } else {
      let pick = 0;
      for (let i = 1; i < remaining.length; i++) {
        if (matrix[current][remaining[i]] < matrix[current][remaining[pick]]) pick = i;
      }
      current = remaining[pick];
      remaining.splice(pick, 1);
    }
    order.push(current);
  }
  return order;
}

/**
 * Heurística: vizinho mais próximo, melhorado por 2-opt (inverte um trecho) e
 * Or-opt (move um bloco de 1 a 3 paradas), até não haver ganho ou estourar o limite.
 * Como a matriz é assimétrica, cada candidato é reavaliado por inteiro.
 */
export function solveHeuristic(problem: RouteProblem, options: SolveOptions = {}): RouteSolution {
  const { maxIterations = 200, timeLimitMs = 250, now = Date.now } = options;
  const deadline = now() + timeLimitMs;

  let order = nearestNeighbor(problem);
  let cost = routeCost(problem, order);
  const n = order.length;
  const hasLocks = lockedPositions(problem).size > 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let improved = false;

    // 2-opt: inverte o trecho [i, j].
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (hasLocks && !respectsLocks(problem, candidate)) continue;
        const candidateCost = routeCost(problem, candidate);
        if (candidateCost < cost) {
          order = candidate;
          cost = candidateCost;
          improved = true;
        }
      }
    }

    // Or-opt: tira um bloco de 1 a 3 paradas e encaixa em outra posição.
    for (let length = 1; length <= 3; length++) {
      for (let i = 0; i + length <= n; i++) {
        const block = order.slice(i, i + length);
        const rest = [...order.slice(0, i), ...order.slice(i + length)];
        for (let position = 0; position <= rest.length; position++) {
          if (position === i) continue;
          const candidate = [...rest.slice(0, position), ...block, ...rest.slice(position)];
          if (hasLocks && !respectsLocks(problem, candidate)) continue;
          const candidateCost = routeCost(problem, candidate);
          if (candidateCost < cost) {
            order = candidate;
            cost = candidateCost;
            improved = true;
            break;
          }
        }
      }
    }

    if (!improved || now() > deadline) break;
  }

  return { order, cost, exact: false };
}

/** Escolhe o método pelo número de paradas. */
export function solveRoute(problem: RouteProblem, options: SolveOptions = {}): RouteSolution {
  const exactMax = options.exactMaxStops ?? EXACT_MAX_STOPS;
  return problem.stops.length <= exactMax ? solveExact(problem) : solveHeuristic(problem, options);
}

/** Faixa de 15 minutos de um instante (a matriz é recalculada quando a faixa muda). */
export const SLOT_MS = 15 * 60 * 1000;
export const timeSlot = (date: Date) => Math.floor(date.getTime() / SLOT_MS);

export interface ArrivalPlan {
  departAt: Date;
  solution: RouteSolution;
  iterations: number;
  /** true quando a saída parou de mudar de faixa de 15 minutos. */
  converged: boolean;
}

/**
 * Modo "Chegar até": saída = chegada − duração total. Como a duração depende
 * do horário de saída (trânsito), repete até a saída ficar na mesma faixa de
 * 15 minutos, em no máximo 3 iterações.
 */
export async function planArrival(
  arriveAt: Date,
  solveAt: (departAt: Date) => Promise<RouteSolution>,
  maxIterations = 3,
  /** Tempo fora do volante (permanência nas paradas) que também sai antes da chegada. */
  extraSeconds: (solution: RouteSolution) => number = () => 0,
): Promise<ArrivalPlan> {
  let departAt = arriveAt;
  let solution = await solveAt(departAt);
  let iterations = 1;

  for (;;) {
    const nextDepart = new Date(arriveAt.getTime() - (solution.cost + extraSeconds(solution)) * 1000);
    const sameSlot = timeSlot(nextDepart) === timeSlot(departAt);
    departAt = nextDepart;
    if (sameSlot) return { departAt, solution, iterations, converged: true };
    if (iterations >= maxIterations) return { departAt, solution, iterations, converged: false };
    solution = await solveAt(departAt);
    iterations += 1;
  }
}
