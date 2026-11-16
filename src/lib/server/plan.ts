/** Planejamento completo no servidor: matriz → solver → horários → geometria. */
import { planArrival, routeCost, solveRoute, type RouteSolution } from "../solver";
import type { TimeMode } from "../types";
import type { MatrixResult, MatrixService, Point } from "./matrix";
import type { GeometryService } from "./route-geometry";

export interface PlanPoint extends Point {
  id: string;
}

export interface PlanRequest {
  start: PlanPoint;
  /** Paradas na ordem digitada. */
  stops: PlanPoint[];
  /** Ponto final diferente do início, quando houver. */
  end: PlanPoint | null;
  /** true = volta ao início (ignora `end`). */
  roundTrip: boolean;
  mode: TimeMode;
  /** Horário de saída ou de chegada. null = agora. */
  at: Date | null;
}

export interface PlanResponse {
  /** Ids das paradas na melhor ordem. */
  order: string[];
  /** Segundos de cada trecho, na sequência início → paradas → fim. */
  legSeconds: number[];
  totalSeconds: number;
  /** Tempo da ordem digitada, com a mesma matriz. */
  typedSeconds: number;
  exact: boolean;
  departAt: string;
  arriveAt: string;
  source: { name: string; label: string; trafficAware: boolean; estimated: boolean };
  /** Linha real da rota em [lng, lat], ou null (traçado aproximado). */
  geometry: [number, number][] | null;
  /** Tempo total conferido pelo Calculate Route, quando disponível. */
  checkedSeconds: number | null;
  /** Modo "Chegar até": quantas vezes a matriz foi recalculada e se estabilizou. */
  arrival: { iterations: number; converged: boolean } | null;
}

export interface PlanDeps {
  matrix: MatrixService;
  geometry: GeometryService;
  now?: () => number;
}

export async function planRoute(request: PlanRequest, deps: PlanDeps): Promise<PlanResponse> {
  const now = deps.now ?? Date.now;
  const { start, stops, mode } = request;

  // Índices: 0 = início, 1..n = paradas, n+1 = fim (se diferente do início).
  const nodes: PlanPoint[] = [start, ...stops];
  let endIndex: number | null = null;
  if (request.roundTrip) endIndex = 0;
  else if (request.end) endIndex = nodes.push(request.end) - 1;
  const stopIndexes = stops.map((_, i) => i + 1);

  let lastMatrix: MatrixResult | null = null;
  const solveAt = async (departAt: Date): Promise<RouteSolution> => {
    lastMatrix = await deps.matrix.getMatrix(nodes, departAt);
    return solveRoute({ matrix: lastMatrix.seconds, start: 0, stops: stopIndexes, end: endIndex });
  };

  const at = request.at ?? new Date(now());
  let departAt: Date;
  let solution: RouteSolution;
  let arrival: PlanResponse["arrival"] = null;

  if (mode === "arrive") {
    const plan = await planArrival(at, solveAt);
    ({ departAt, solution } = plan);
    arrival = { iterations: plan.iterations, converged: plan.converged };
  } else {
    departAt = at;
    solution = await solveAt(departAt);
  }

  const matrix = lastMatrix!;
  const problem = { matrix: matrix.seconds, start: 0, end: endIndex };
  const typedSeconds = routeCost(problem, stopIndexes);
  // Empate: mantém a ordem digitada, para a lista não mudar sem ganho.
  const order = solution.cost >= typedSeconds ? stopIndexes : solution.order;

  const sequence = [0, ...order, ...(endIndex === null ? [] : [endIndex])];
  const legSeconds = sequence.slice(1).map((to, i) => matrix.seconds[sequence[i]][to]);
  const totalSeconds = legSeconds.reduce((sum, s) => sum + s, 0);

  const route =
    sequence.length >= 2
      ? await deps.geometry.getRoute(
          sequence.map((i) => nodes[i]),
          departAt,
        )
      : null;

  return {
    order: order.map((i) => nodes[i].id),
    legSeconds,
    totalSeconds,
    typedSeconds,
    exact: solution.exact,
    departAt: departAt.toISOString(),
    arriveAt: new Date(departAt.getTime() + totalSeconds * 1000).toISOString(),
    source: {
      name: matrix.source,
      label: matrix.label,
      trafficAware: matrix.trafficAware,
      estimated: matrix.estimated,
    },
    geometry: route?.coordinates ?? null,
    checkedSeconds: route?.seconds ?? null,
    arrival,
  };
}
