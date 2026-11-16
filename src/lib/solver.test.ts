import { describe, expect, it } from "vitest";
import { FIXTURE_PLACES, fixtureSeconds } from "./mock-data";
import { optimizeStops } from "./optimize";
import {
  nearestNeighbor,
  planArrival,
  routeCost,
  solveExact,
  solveHeuristic,
  solveRoute,
  timeSlot,
  type RouteProblem,
} from "./solver";
import { isApproximate, MAX_STOPS } from "./stops";
import type { LegTimeFn, Place } from "./types";

/** Gerador determinístico (mulberry32), para os testes serem reproduzíveis. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Matriz assimétrica aleatória: distância no plano com um fator diferente por sentido. */
function randomMatrix(size: number, random: () => number): number[][] {
  const points = Array.from({ length: size }, () => [random() * 100, random() * 100]);
  return points.map((a, i) =>
    points.map((b, j) =>
      i === j ? 0 : Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 60 * (0.7 + random() * 0.6)),
    ),
  );
}

function bruteForce(problem: RouteProblem): number {
  let best = Infinity;
  const permute = (rest: number[], order: number[]) => {
    if (rest.length === 0) {
      best = Math.min(best, routeCost(problem, order));
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...order, rest[i]]);
    }
  };
  permute([...problem.stops], []);
  return best;
}

const IDS = ["B", "Be", "PN", "CC", "PC", "Bf"] as const;
function fixtureMatrix(slot: "t0900" | "t1800"): number[][] {
  return IDS.map((from) => IDS.map((to) => (from === to ? 0 : fixtureSeconds(slot, from, to)!)));
}
const name = (order: number[]) => order.map((i) => IDS[i]).join(" → ");

describe("fixtures da TomTom (terça-feira 2026-11-17)", () => {
  // Início e fim em B (ciclo), paradas [Be, PN, CC] na ordem digitada.
  const problem = (slot: "t0900" | "t1800"): RouteProblem => ({
    matrix: fixtureMatrix(slot),
    start: 0,
    stops: [1, 2, 3],
    end: 0,
  });

  it("ordem digitada: 9419 s às 09:00 e 9657 s às 18:00", () => {
    expect(routeCost(problem("t0900"), [1, 2, 3])).toBe(9419);
    expect(routeCost(problem("t1800"), [1, 2, 3])).toBe(9657);
  });

  it("ordem ótima: B → CC → Be → PN → B (ou a inversa), 7984 s e 8304 s", () => {
    for (const [slot, cost] of [
      ["t0900", 7984],
      ["t1800", 8304],
    ] as const) {
      const solution = solveRoute(problem(slot));
      expect(solution.cost).toBe(cost);
      expect(solution.exact).toBe(true);
      expect(["CC → Be → PN", "PN → Be → CC"]).toContain(name(solution.order));
    }
  });

  it("caminho com fim escolhido e caminho aberto", () => {
    const matrix = fixtureMatrix("t0900");
    // B → … → Bf, passando por Be, PN e PC.
    const toEnd = solveRoute({ matrix, start: 0, stops: [1, 2, 4], end: 5 });
    expect(toEnd.cost).toBe(bruteForce({ matrix, start: 0, stops: [1, 2, 4], end: 5 }));
    expect(toEnd.order).toHaveLength(3);
    // Sem fim: termina na última parada, então custa menos que voltar ao início.
    const open = solveRoute({ matrix, start: 0, stops: [1, 2, 3], end: null });
    expect(open.cost).toBe(bruteForce({ matrix, start: 0, stops: [1, 2, 3], end: null }));
    expect(open.cost).toBeLessThan(7984);
  });

  it("sem paradas: só o trecho início → fim", () => {
    const matrix = fixtureMatrix("t0900");
    expect(solveRoute({ matrix, start: 0, stops: [], end: 1 })).toEqual({ order: [], cost: 3049, exact: true });
    expect(solveRoute({ matrix, start: 0, stops: [], end: 0 }).cost).toBe(0);
    expect(solveRoute({ matrix, start: 0, stops: [], end: null }).cost).toBe(0);
  });
});

describe("Held-Karp", () => {
  it("é igual à força bruta em 200 instâncias aleatórias com até 8 paradas", () => {
    const random = rng(20261117);
    for (let instance = 0; instance < 200; instance++) {
      const stopCount = 1 + Math.floor(random() * 8);
      // Alterna entre ciclo, fim escolhido e caminho aberto.
      const mode = instance % 3;
      const size = stopCount + (mode === 1 ? 2 : 1);
      const problem: RouteProblem = {
        matrix: randomMatrix(size, random),
        start: 0,
        stops: Array.from({ length: stopCount }, (_, i) => i + 1),
        end: mode === 0 ? 0 : mode === 1 ? size - 1 : null,
      };
      const solution = solveExact(problem);
      expect(solution.cost, `instância ${instance}`).toBe(bruteForce(problem));
      // A ordem devolvida tem mesmo esse custo e visita cada parada uma vez.
      expect(routeCost(problem, solution.order)).toBe(solution.cost);
      expect([...solution.order].sort((a, b) => a - b)).toEqual(problem.stops);
    }
  });

  it("respeita a assimetria da matriz", () => {
    // Ir 0→1→2→0 custa 3; o sentido contrário custa 300.
    const matrix = [
      [0, 1, 100],
      [100, 0, 1],
      [1, 100, 0],
    ];
    expect(solveExact({ matrix, start: 0, stops: [2, 1], end: 0 })).toMatchObject({ order: [1, 2], cost: 3 });
  });
});

describe("heurística (11 a 20 paradas)", () => {
  it("nunca é pior que o vizinho mais próximo puro e fica, em média, bem abaixo de 1.10 × ele", () => {
    const random = rng(42);
    let heuristicSum = 0;
    let nearestSum = 0;
    for (let stopCount = 11; stopCount <= MAX_STOPS; stopCount++) {
      for (let repeat = 0; repeat < 6; repeat++) {
        const cycle = repeat % 2 === 0;
        const problem: RouteProblem = {
          matrix: randomMatrix(stopCount + 1, random),
          start: 0,
          stops: Array.from({ length: stopCount }, (_, i) => i + 1),
          end: cycle ? 0 : null,
        };
        const nearest = routeCost(problem, nearestNeighbor(problem));
        const solution = solveRoute(problem);
        expect(solution.exact).toBe(false);
        expect(solution.cost).toBeLessThanOrEqual(nearest);
        expect(routeCost(problem, solution.order)).toBe(solution.cost);
        expect([...solution.order].sort((a, b) => a - b)).toEqual(problem.stops);
        heuristicSum += solution.cost;
        nearestSum += nearest;
      }
    }
    expect(heuristicSum).toBeLessThanOrEqual(1.1 * nearestSum);
    expect(heuristicSum).toBeLessThan(nearestSum);
  });

  it("fica, em média, a até 10% do ótimo (conferido com Held-Karp em 11 a 13 paradas)", () => {
    const random = rng(7);
    let heuristicSum = 0;
    let optimalSum = 0;
    for (let stopCount = 11; stopCount <= 13; stopCount++) {
      for (let repeat = 0; repeat < 4; repeat++) {
        const problem: RouteProblem = {
          matrix: randomMatrix(stopCount + 1, random),
          start: 0,
          stops: Array.from({ length: stopCount }, (_, i) => i + 1),
          end: 0,
        };
        heuristicSum += solveHeuristic(problem).cost;
        optimalSum += solveExact(problem).cost;
      }
    }
    expect(heuristicSum).toBeLessThanOrEqual(1.1 * optimalSum);
  });

  it("respeita o limite de tempo", () => {
    const random = rng(3);
    const problem: RouteProblem = {
      matrix: randomMatrix(21, random),
      start: 0,
      stops: Array.from({ length: 20 }, (_, i) => i + 1),
      end: 0,
    };
    let clock = 0;
    // Relógio falso: cada consulta avança 1 s, então o limite estoura na 1ª iteração.
    const solution = solveHeuristic(problem, { timeLimitMs: 1, now: () => (clock += 1000) });
    expect(solution.cost).toBeLessThanOrEqual(routeCost(problem, nearestNeighbor(problem)));
  });

  it("resolve 20 paradas rápido", () => {
    const random = rng(11);
    const problem: RouteProblem = {
      matrix: randomMatrix(21, random),
      start: 0,
      stops: Array.from({ length: 20 }, (_, i) => i + 1),
      end: 0,
    };
    const started = performance.now();
    solveRoute(problem);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("limites de paradas", () => {
  it("exata até 10 paradas, aproximada (com aviso) a partir de 11, no máximo 20", () => {
    const random = rng(5);
    const solveWith = (stopCount: number) =>
      solveRoute({
        matrix: randomMatrix(stopCount + 1, random),
        start: 0,
        stops: Array.from({ length: stopCount }, (_, i) => i + 1),
        end: 0,
      });
    expect(solveWith(10).exact).toBe(true);
    expect(isApproximate(10)).toBe(false);
    expect(solveWith(11).exact).toBe(false);
    expect(isApproximate(11)).toBe(true);
    expect(MAX_STOPS).toBe(20);
  });
});

describe("modo Chegar até", () => {
  // Trânsito que depende do horário de saída: manhã (t0900) ou tarde (t1800).
  const solveAt = async (departAt: Date) =>
    solveRoute({
      matrix: fixtureMatrix(departAt.getHours() < 13 ? "t0900" : "t1800"),
      start: 0,
      stops: [1, 2, 3],
      end: 0,
    });

  it("saída = chegada − duração total, convergindo em até 3 iterações", async () => {
    const arriveAt = new Date(2026, 10, 17, 20, 0);
    const plan = await planArrival(arriveAt, solveAt);
    expect(plan.converged).toBe(true);
    expect(plan.iterations).toBeLessThanOrEqual(3);
    expect(plan.solution.cost).toBe(8304);
    expect(plan.departAt.getTime()).toBe(arriveAt.getTime() - 8304_000);
  });

  it("recalcula quando a saída cai em outra faixa de trânsito", async () => {
    // Chegar às 13:30: a 1ª conta usa a tarde, mas a saída cai de manhã.
    const arriveAt = new Date(2026, 10, 17, 13, 30);
    const seen: number[] = [];
    const plan = await planArrival(arriveAt, async (departAt) => {
      seen.push(departAt.getHours());
      return solveAt(departAt);
    });
    expect(seen[0]).toBe(13);
    expect(seen[1]).toBeLessThan(13);
    expect(plan.solution.cost).toBe(7984);
    expect(plan.converged).toBe(true);
    expect(plan.iterations).toBeLessThanOrEqual(3);
    expect(plan.departAt.getTime()).toBe(arriveAt.getTime() - 7984_000);
  });

  it("para em 3 iterações mesmo sem convergir", async () => {
    let calls = 0;
    // Duração que cresce 1 h a cada conta: a saída nunca estabiliza.
    const plan = await planArrival(new Date(2026, 10, 17, 20, 0), async () => {
      calls += 1;
      return { order: [], cost: calls * 3600, exact: true };
    });
    expect(calls).toBe(3);
    expect(plan.iterations).toBe(3);
    expect(plan.converged).toBe(false);
  });

  it("faixas de 15 minutos", () => {
    const at = (h: number, m: number) => timeSlot(new Date(2026, 10, 17, h, m));
    expect(at(9, 0)).toBe(at(9, 14));
    expect(at(9, 15)).toBe(at(9, 0) + 1);
  });
});

describe("otimização sobre locais (usada pela interface)", () => {
  const P = FIXTURE_PLACES;
  const legTime: LegTimeFn = (from, to) => ({
    seconds: from.id === to.id ? 0 : fixtureSeconds("t0900", from.id, to.id)!,
    estimated: false,
  });

  it("switch ligado (ciclo): reordena as paradas digitadas", () => {
    const result = optimizeStops(P.B, [P.Be, P.PN, P.CC], P.B, legTime);
    expect(result.seconds).toBe(7984);
    expect(result.typedSeconds).toBe(9419);
    expect(result.exact).toBe(true);
    expect(["CC,Be,PN", "PN,Be,CC"]).toContain(result.stops.map((s) => s.id).join());
  });

  it("switch desligado (caminho): com fim escolhido e sem fim", () => {
    const toEnd = optimizeStops(P.B, [P.Be, P.PN, P.CC], P.Bf, legTime);
    const open = optimizeStops(P.B, [P.Be, P.PN, P.CC], null, legTime);
    const cycle = optimizeStops(P.B, [P.Be, P.PN, P.CC], P.B, legTime);
    // B → CC → Be → PN → Bf: 2012 + 1493 + 1894 + 1608
    expect(toEnd.seconds).toBe(7007);
    expect(toEnd.stops.map((s) => s.id).join()).toBe("CC,Be,PN");
    // Sem fim, a rota termina na última parada.
    expect(open.seconds).toBe(2012 + 1493 + 1894);
    expect(open.seconds).toBeLessThan(cycle.seconds);
  });

  it("mantém a ordem digitada quando ela já é a melhor", () => {
    const typed: Place[] = [P.CC, P.Be, P.PN];
    const result = optimizeStops(P.B, typed, P.B, legTime);
    expect(result.seconds).toBe(result.typedSeconds);
    expect(result.stops).toEqual(typed);
  });
});
