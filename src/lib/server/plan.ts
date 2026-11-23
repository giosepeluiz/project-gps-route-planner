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
  /** Direção do carro no início (viagem em andamento), em graus. */
  heading?: number;
  /**
   * Chegada obrigatória numa parada, com a saída fixa (mode "depart"): o solver
   * escolhe a posição dela na visita em que chega o mais perto possível do horário
   * sem passar dele.
   */
  deadline?: { stopId: string; at: Date };
}

/** Resultado da chegada obrigatória: onde a parada ficou e quanto sobra (ou falta) de tempo. */
export interface DeadlineResult {
  stopId: string;
  /** Posição na visita (0 = primeira parada). */
  position: number;
  /** Segundos desde a saída até chegar nela (direção + permanência das anteriores). */
  arriveSeconds: number;
  /** Segundos entre a saída e o horário obrigatório. */
  targetSeconds: number;
  /** Folga (positiva: chega antes e espera) ou atraso (negativo), em segundos. */
  slackSeconds: number;
  /** true = nem na melhor posição dá para chegar a tempo. */
  late: boolean;
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
  /** Chegada obrigatória numa parada com saída fixa, quando pedida. */
  deadline: DeadlineResult | null;
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
  const deadlineBox: { value: DeadlineResult | null } = { value: null };
  const deadlineStop = request.deadline ? stops.findIndex((s) => s.id === request.deadline!.stopId) + 1 : 0;
  const solveAt = async (departAt: Date): Promise<RouteSolution> => {
    lastMatrix = await deps.matrix.getMatrix(nodes, departAt);
    const problem = { matrix: lastMatrix.seconds, start: 0, stops: stopIndexes, end: endIndex };
    const best = solveRoute(problem);
    bestSeconds = best.cost;
    if (request.deadline && deadlineStop > 0 && mode === "depart") {
      const matrixSeconds = lastMatrix.seconds;
      const target = Math.round((request.deadline.at.getTime() - departAt.getTime()) / 1000);
      const arriveAt = (order: readonly number[]) => {
        const stopAt = order.indexOf(deadlineStop);
        const sequence = [0, ...order.slice(0, stopAt + 1)];
        let seconds = 0;
        sequence.forEach((node, i) => {
          if (i > 0) seconds += matrixSeconds[sequence[i - 1]][node];
          if (i > 0 && i < sequence.length - 1) seconds += dwellOf(nodes[node]);
        });
        return seconds;
      };
      // Se a parada já está travada numa posição, só essa vale; senão, testa cada posição.
      const lockedAt = [...fixed].find(([, stop]) => stop === deadlineStop)?.[0];
      const candidates: { position: number; solution: RouteSolution; arrive: number }[] = [];
      for (let position = 0; position < stops.length; position++) {
        if (lockedAt !== undefined && position !== lockedAt) continue;
        if (lockedAt === undefined && fixed.has(position)) continue;
        const withDeadline = new Map(fixed);
        withDeadline.set(position, deadlineStop);
        const candidate = solveRoute({ ...problem, fixed: withDeadline });
        candidates.push({ position, solution: candidate, arrive: arriveAt(candidate.order) });
      }
      const onTime = candidates.filter((c) => c.arrive <= target);
      // A que chega mais perto do horário sem passar dele; empate: a mais rápida no total.
      const chosen =
        onTime.length > 0
          ? onTime.reduce((a, b) => (b.arrive > a.arrive || (b.arrive === a.arrive && b.solution.cost < a.solution.cost) ? b : a))
          : candidates.reduce((a, b) => (b.arrive < a.arrive ? b : a), candidates[0]);
      if (chosen) {
        deadlineBox.value = {
          stopId: request.deadline.stopId,
          position: chosen.position,
          arriveSeconds: chosen.arrive,
          targetSeconds: target,
          slackSeconds: target - chosen.arrive,
          late: chosen.arrive > target,
        };
        return chosen.solution;
      }
    }
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
  const deadlineResult = deadlineBox.value;
  const order =
    !deadlineResult && solution.cost >= typedSeconds && typedRespectsLocks ? stopIndexes : solution.order;

  const sequence = [0, ...order, ...(endIndex === null ? [] : [endIndex])];
  const legSeconds = sequence.slice(1).map((to, i) => matrix.seconds[sequence[i]][to]);
  const totalSeconds = legSeconds.reduce((sum, s) => sum + s, 0);
  const dwellSeconds = dwellFor(order);
  // O tempo de espera até o horário obrigatório (chegou antes) entra no fim da rota.
  const waitSeconds = deadlineResult && deadlineResult.slackSeconds > 0 ? deadlineResult.slackSeconds : 0;

  const route =
    sequence.length >= 2
      ? await deps.geometry.getRoute(
          sequence.map((i) => nodes[i]),
          departAt,
          request.heading === undefined ? undefined : { heading: request.heading },
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
    arriveAt: new Date(departAt.getTime() + (totalSeconds + dwellSeconds + waitSeconds) * 1000).toISOString(),
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
    deadline: deadlineResult,
  };
}
