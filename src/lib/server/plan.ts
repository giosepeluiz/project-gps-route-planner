/** Planejamento completo no servidor: matriz → solver → horários → geometria. */
import { planArrival, routeCost, solveRoute, type RouteSolution } from "../solver";
import type { TimeMode } from "../types";
import { NoRouteError, type MatrixResult, type MatrixService, type Point } from "./matrix";
import type { GeometryService, RouteLeg } from "./route-geometry";

export interface PlanPoint extends Point {
  id: string;
  /** Permanência na parada, em minutos. Só vale para as paradas. */
  dwellMin?: number;
}

const dwellOf = (p: PlanPoint) =>
  Number.isFinite(p.dwellMin) && (p.dwellMin ?? 0) > 0 ? Math.round(p.dwellMin!) * 60 : 0;

export interface PlanRequest {
  start: PlanPoint;
  /** Paradas na ordem digitada. */
  stops: PlanPoint[];
  /** Ponto final diferente do início, quando houver. */
  end: PlanPoint | null;
  /** true = volta ao início (ignora `end`). */
  roundTrip: boolean;
  /** Locais travados: id da parada → posição na visita (0 = primeira parada). */
  locks?: Record<string, number>;
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
  /** Permanência somada nas paradas (fora de totalSeconds, que é só direção). */
  dwellSeconds: number;
  /** Tempo da ordem digitada, com a mesma matriz. */
  typedSeconds: number;
  /** Tempo da melhor ordem sem nenhuma trava (igual a totalSeconds quando não há travas). */
  bestSeconds: number;
  exact: boolean;
  /** Quantos locais travados foram respeitados. */
  lockedCount: number;
  departAt: string;
  arriveAt: string;
  source: { name: string; label: string; trafficAware: boolean; estimated: boolean };
  /** Rota pelas ruas, um item por trecho, ou null (só as retas entre os pontos). */
  streetLegs: RouteLeg[] | null;
  /** Provedor da rota pelas ruas. */
  streetSource: string | null;
  /** Tempo total conferido pela rota pelas ruas, quando disponível. */
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
  // Posição travada → índice da parada. Travas inválidas ou repetidas são ignoradas.
  const fixed = new Map<number, number>();
  stops.forEach((stop, i) => {
    const position = request.locks?.[stop.id];
    if (
      position !== undefined &&
      Number.isInteger(position) &&
      position >= 0 &&
      position < stops.length &&
      !fixed.has(position)
    ) {
      fixed.set(position, i + 1);
    }
  });
  let bestSeconds = 0;
  const solveAt = async (departAt: Date): Promise<RouteSolution> => {
    lastMatrix = await deps.matrix.getMatrix(nodes, departAt);
    const problem = { matrix: lastMatrix.seconds, start: 0, stops: stopIndexes, end: endIndex };
    const best = solveRoute(problem);
    bestSeconds = best.cost;
    // Com travas, a melhor ordem livre fica só para comparação.
    return fixed.size > 0 ? solveRoute({ ...problem, fixed }) : best;
  };

  // Permanência: conta em toda parada, menos na última quando a rota termina nela.
  const dwellFor = (order: readonly number[]) =>
    order.reduce(
      (sum, node, i) => sum + (endIndex === null && i === order.length - 1 ? 0 : dwellOf(nodes[node])),
      0,
    );

  const at = request.at ?? new Date(now());
  let departAt: Date;
  let solution: RouteSolution;
  let arrival: PlanResponse["arrival"] = null;

  if (mode === "arrive") {
    const plan = await planArrival(at, solveAt, 3, (s) => dwellFor(s.order));
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
  const typedRespectsLocks = [...fixed].every(([position, stop]) => stopIndexes[position] === stop);
  const order =
    solution.cost >= typedSeconds && typedRespectsLocks ? stopIndexes : solution.order;

  const sequence = [0, ...order, ...(endIndex === null ? [] : [endIndex])];
  const legSeconds = sequence.slice(1).map((to, i) => matrix.seconds[sequence[i]][to]);
  const totalSeconds = legSeconds.reduce((sum, s) => sum + s, 0);
  const dwellSeconds = dwellFor(order);

  const route =
    sequence.length >= 2
      ? await deps.geometry.getRoute(
          sequence.map((i) => nodes[i]),
          departAt,
        )
      : null;

  // A rota pelas ruas confirma (ou nega) que dá para ir de carro, sem balsa.
  if (route === "no-route") throw new NoRouteError();

  return {
    order: order.map((i) => nodes[i].id),
    legSeconds,
    totalSeconds,
    dwellSeconds,
    typedSeconds,
    bestSeconds,
    exact: solution.exact,
    lockedCount: fixed.size,
    departAt: departAt.toISOString(),
    arriveAt: new Date(departAt.getTime() + (totalSeconds + dwellSeconds) * 1000).toISOString(),
    source: {
      name: matrix.source,
      label: matrix.label,
      trafficAware: matrix.trafficAware,
      estimated: matrix.estimated,
    },
    streetLegs: route?.legs ?? null,
    streetSource: route?.source ?? null,
    checkedSeconds: route?.seconds ?? null,
    arrival,
  };
}
