import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "./server/cache";
import { createGoogleMatrix, createHereMatrix, createMatrixService, createTomTomMatrix } from "./server/matrix";
import { planRoute, type PlanPoint } from "./server/plan";
import { createGoogleGeometry, type GeometryService, type RouteGeometry } from "./server/route-geometry";
import { QuotaError } from "./server/resilience";
import { BUDGET_DEFAULTS, budgetLimits, createBudget } from "./server/usage";

const NOW = Date.UTC(2026, 10, 24, 9, 0);
const DEPART = new Date(NOW + 24 * 3600_000);
const pts = [
  { lat: 38.72, lng: -9.14 },
  { lat: 38.73, lng: -9.15 },
  { lat: 38.74, lng: -9.16 },
];
const json = (body: unknown, status = 200) => Response.json(body, { status });

describe("trava de cota", () => {
  it("recusa a chamada que passaria do limite e conta só o que passou", async () => {
    const budget = createBudget({ cache: new MemoryCache(), limits: { ...BUDGET_DEFAULTS, google: 10 }, now: () => NOW });
    await budget.take("google", 6);
    await expect(budget.take("google", 6)).rejects.toBeInstanceOf(QuotaError);
    await budget.take("google", 4); // 6 + 4 = 10: ainda cabe
    await expect(budget.take("google", 1)).rejects.toThrow(/limite mensal/);
    expect((await budget.usage()).google).toEqual({ used: 10, limit: 10 });
  });

  it("zera a cada mês", async () => {
    let now = NOW;
    const budget = createBudget({ cache: new MemoryCache(), limits: { ...BUDGET_DEFAULTS, google: 5 }, now: () => now });
    await budget.take("google", 5);
    now = Date.UTC(2026, 11, 2);
    await budget.take("google", 5);
    expect((await budget.usage()).google.used).toBe(5);
  });

  it("limites: padrão 10% abaixo da cota grátis; variável de ambiente muda; 0 desliga", () => {
    expect(budgetLimits({}).google).toBe(4500);
    expect(budgetLimits({ QUOTA_GOOGLE: "1000", QUOTA_HERE: "0", QUOTA_TOMTOM: "abc" })).toMatchObject({
      google: 1000,
      here: 0,
      tomtom: 2250,
    });
  });

  it("a cadeia pula o provedor que bateu no limite do app, sem fazer a chamada", async () => {
    const tomtomFetch = vi.fn(async () => json({ data: [] }));
    const budget = createBudget({ cache: new MemoryCache(), limits: { ...BUDGET_DEFAULTS, tomtom: 0 }, now: () => NOW });
    const hereFetch = vi.fn(async () =>
      json({ matrix: { numOrigins: 3, numDestinations: 3, travelTimes: [0, 5, 6, 5, 0, 7, 6, 7, 0] } }),
    );
    const service = createMatrixService({
      providers: [
        createTomTomMatrix("T", tomtomFetch as unknown as typeof fetch, () => NOW, 100, budget),
        createHereMatrix("H", hereFetch as unknown as typeof fetch, () => NOW, budget),
      ],
      cache: new MemoryCache(),
      now: () => NOW,
      retries: 0,
    });
    const result = await service.getMatrix(pts, DEPART);
    expect(result.source).toBe("here");
    expect(tomtomFetch).not.toHaveBeenCalled();
  });

  it("HERE conta por célula (padrão) ou por pedido", async () => {
    const reply = async () => json({ matrix: { numOrigins: 3, numDestinations: 3, travelTimes: new Array(9).fill(60) } });
    const b1 = createBudget({ cache: new MemoryCache(), now: () => NOW });
    await createHereMatrix("H", reply as unknown as typeof fetch, () => NOW, b1).getCells(pts, pts, DEPART, AbortSignal.timeout(1000));
    expect((await b1.usage()).here.used).toBe(9);
    const b2 = createBudget({ cache: new MemoryCache(), now: () => NOW });
    await createHereMatrix("H", reply as unknown as typeof fetch, () => NOW, b2, "request").getCells(pts, pts, DEPART, AbortSignal.timeout(1000));
    expect((await b2.usage()).here.used).toBe(1);
  });
});

describe("Google", () => {
  it("matriz: pedido com TRAFFIC_AWARE, chave no cabeçalho e leitura dos elementos (conta elementos)", async () => {
    const fetchFn = vi.fn(async () =>
      json(
        pts.flatMap((_, o) =>
          pts.map((__, d) => ({
            originIndex: o,
            destinationIndex: d,
            status: {},
            condition: "ROUTE_EXISTS",
            distanceMeters: 1000 * (o + d),
            duration: `${60 + o * 10 + d}s`,
          })),
        ),
      ),
    );
    const budget = createBudget({ cache: new MemoryCache(), now: () => NOW });
    const google = createGoogleMatrix("CHAVE", fetchFn as unknown as typeof fetch, () => NOW, budget);
    const block = await google.getCells(pts, pts, DEPART, AbortSignal.timeout(1000));
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("CHAVE");
    expect(headers["X-Goog-FieldMask"]).toContain("status");
    const body = JSON.parse(String(init.body));
    expect(body.routingPreference).toBe("TRAFFIC_AWARE");
    expect(body.travelMode).toBe("DRIVE");
    expect(body.departureTime).toBe(DEPART.toISOString());
    expect(block.seconds[1][2]).toBe(72);
    expect((await budget.usage()).google.used).toBe(9);
  });

  it("geometria: rota com todos os pontos, sem balsas, trechos com tempo e linha", async () => {
    const leg = (s: number) => ({
      duration: `${s}s`,
      distanceMeters: s * 10,
      polyline: {
        geoJsonLinestring: {
          type: "LineString",
          coordinates: [
            [-9.14, 38.72],
            [-9.15, 38.73],
          ],
        },
      },
    });
    const fetchFn = vi.fn(async () => json({ routes: [{ legs: [leg(300), leg(420)] }] }));
    const budget = createBudget({ cache: new MemoryCache(), now: () => NOW });
    const geometry = createGoogleGeometry("K", new MemoryCache(), fetchFn as unknown as typeof fetch, () => NOW, budget);
    const route = await geometry.getRoute(pts, DEPART);
    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.routeModifiers).toEqual({ avoidFerries: true });
    expect(body.intermediates).toHaveLength(1);
    expect(body.polylineEncoding).toBe("GEO_JSON_LINESTRING");
    expect(route && route !== "no-route" ? route.legs.map((l) => l.seconds) : null).toEqual([300, 420]);
    expect((await budget.usage())["google-rota"].used).toBe(1);
  });

  it("geometria devolve null (e não chama) quando o limite do app acabou", async () => {
    const fetchFn = vi.fn();
    const budget = createBudget({ cache: new MemoryCache(), limits: { ...BUDGET_DEFAULTS, "google-rota": 0 }, now: () => NOW });
    const geometry = createGoogleGeometry("K", new MemoryCache(), fetchFn as unknown as typeof fetch, () => NOW, budget);
    expect(await geometry.getRoute(pts, DEPART)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("planejamento com tudo travado: uma rota, sem matriz", () => {
  const P = (id: string, i: number): PlanPoint => ({ id, lat: 38.7 + i * 0.01, lng: -9.1 - i * 0.01 });
  const start = P("S", 0);
  const stops = [P("A", 1), P("B", 2), P("C", 3)];

  it("usa só a rota (a matriz nunca é chamada) e respeita a ordem travada", async () => {
    const getMatrix = vi.fn();
    const route: RouteGeometry = {
      source: "TomTom",
      legs: [100, 200, 300].map((s) => ({
        coordinates: [
          [-9.1, 38.7],
          [-9.2, 38.8],
        ] as [number, number][],
        seconds: s,
        meters: s * 10,
      })),
      seconds: 600,
      meters: 6000,
    };
    const geometry: GeometryService = { getRoute: vi.fn(async () => route) };
    const plan = await planRoute(
      // Ordem travada: C, A, B.
      { start, stops, end: null, roundTrip: false, mode: "depart", at: DEPART, locks: { C: 0, A: 1, B: 2 } },
      { matrix: { getMatrix } as never, geometry, now: () => NOW },
    );
    expect(getMatrix).not.toHaveBeenCalled();
    expect(plan.order).toEqual(["C", "A", "B"]);
    expect(plan.legSeconds).toEqual([100, 200, 300]);
    expect(plan.totalSeconds).toBe(600);
    expect(plan.source.trafficAware).toBe(true);
    expect(plan.lockedCount).toBe(3);
    const asked = (geometry.getRoute as ReturnType<typeof vi.fn>).mock.calls[0][0] as { lat: number }[];
    expect(asked).toHaveLength(4);
  });

  it("sem rota (null) cai no caminho da matriz; com uma só trava, a matriz continua em uso", async () => {
    const matrix = {
      getMatrix: vi.fn(async () => ({
        seconds: [
          [0, 10, 20, 30],
          [10, 0, 15, 25],
          [20, 15, 0, 5],
          [30, 25, 5, 0],
        ],
        source: "estimativa",
        label: "x",
        trafficAware: false,
        estimated: true,
      })),
    };
    const down: GeometryService = { getRoute: vi.fn(async () => null) };
    const allLocked = await planRoute(
      { start, stops, end: null, roundTrip: false, mode: "depart", at: DEPART, locks: { A: 0, B: 1, C: 2 } },
      { matrix: matrix as never, geometry: down, now: () => NOW },
    );
    expect(matrix.getMatrix).toHaveBeenCalledTimes(1);
    expect(allLocked.order).toEqual(["A", "B", "C"]);

    const oneLock = await planRoute(
      { start, stops, end: null, roundTrip: false, mode: "depart", at: DEPART, locks: { A: 0 } },
      { matrix: matrix as never, geometry: down, now: () => NOW },
    );
    expect(matrix.getMatrix).toHaveBeenCalledTimes(2);
    expect(oneLock.order[0]).toBe("A");
  });
});
