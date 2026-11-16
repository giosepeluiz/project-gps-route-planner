import { describe, expect, it, vi } from "vitest";
import { FIXTURE_PLACES as P, fixtureSeconds } from "./mock-data";
import { planRequestBody } from "./plan-client";
import { MemoryCache } from "./server/cache";
import {
  createMatrixService,
  createOrsMatrix,
  createTomTomMatrix,
  estimateProvider,
  planRequests,
  type MatrixProvider,
  type Point,
} from "./server/matrix";
import { planRoute, type PlanPoint } from "./server/plan";
import { createTomTomGeometry, noGeometry } from "./server/route-geometry";

const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});
const TUESDAY_9 = new Date(Date.UTC(2026, 10, 17, 9, 0));
const NOW = Date.UTC(2026, 10, 16, 12, 0);

const pts: PlanPoint[] = [P.B, P.Be, P.PN, P.CC].map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }));
const idOf = (p: Point) => pts.find((x) => x.lat === p.lat && x.lng === p.lng)!.id;

/** Provedor falso com os tempos dos fixtures das 09:00. */
function fixtureProvider(name: string, behavior: "ok" | "error" = "ok") {
  const provider: MatrixProvider & { calls: number; cells: number } = {
    name,
    trafficAware: name === "tomtom",
    label: name === "tomtom" ? "TomTom com trânsito" : `${name}, sem previsão de trânsito`,
    calls: 0,
    cells: 0,
    async getCells(origins, destinations) {
      provider.calls += 1;
      if (behavior === "error") throw new Error(`${name} fora do ar`);
      provider.cells += origins.length * destinations.length;
      return {
        seconds: origins.map((a) =>
          destinations.map((b) => (idOf(a) === idOf(b) ? 0 : fixtureSeconds("t0900", idOf(a), idOf(b))!)),
        ),
      };
    },
  };
  return provider;
}

describe("cadeia de provedores de matriz", () => {
  it("usa o primário (TomTom, com trânsito) quando ele responde", async () => {
    const tomtom = fixtureProvider("tomtom");
    const ors = fixtureProvider("openrouteservice");
    const service = createMatrixService({ providers: [tomtom, ors], cache: new MemoryCache(), now: () => NOW });
    const result = await service.getMatrix(pts, TUESDAY_9);
    expect(result).toMatchObject({ source: "tomtom", trafficAware: true, estimated: false });
    expect(result.seconds[0][1]).toBe(3049);
    expect(result.seconds[1][0]).toBe(3049);
    expect(result.seconds[2][2]).toBe(0);
    expect(ors.calls).toBe(0);
  });

  it("falha do primário aciona o backup, rotulado como sem trânsito", async () => {
    const warn = quiet();
    const tomtom = fixtureProvider("tomtom", "error");
    const ors = fixtureProvider("openrouteservice");
    const service = createMatrixService({ providers: [tomtom, ors], cache: new MemoryCache(), now: () => NOW });
    const result = await service.getMatrix(pts, TUESDAY_9);
    expect(result.source).toBe("openrouteservice");
    expect(result.trafficAware).toBe(false);
    expect(result.label).toContain("sem previsão de trânsito");
    expect(tomtom.calls).toBe(2); // tentativa + 1 retry
    warn.mockRestore();
  });

  it("falha de todos aciona o último recurso (estimativa por distância)", async () => {
    const warn = quiet();
    const service = createMatrixService({
      providers: [fixtureProvider("tomtom", "error"), fixtureProvider("openrouteservice", "error")],
      cache: new MemoryCache(),
      now: () => NOW,
    });
    const result = await service.getMatrix(pts, TUESDAY_9);
    expect(result).toMatchObject({ source: "estimativa", estimated: true, trafficAware: false });
    expect(result.label).toContain("Estimativa");
    expect(result.seconds[0][1]).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it("sem nenhuma chave configurada, responde com a estimativa", async () => {
    const service = createMatrixService({ providers: [], cache: new MemoryCache() });
    expect((await service.getMatrix(pts, TUESDAY_9)).source).toBe("estimativa");
  });

  it("circuit breaker: após 3 falhas seguidas, pula o provedor por 60 s", async () => {
    const warn = quiet();
    let now = NOW;
    const tomtom = fixtureProvider("tomtom", "error");
    const service = createMatrixService({ providers: [tomtom], cache: new MemoryCache(), now: () => now });
    for (let i = 0; i < 3; i++) await service.getMatrix(pts, TUESDAY_9);
    expect(tomtom.calls).toBe(6);
    await service.getMatrix(pts, TUESDAY_9);
    expect(tomtom.calls).toBe(6); // circuito aberto: nem tenta
    now += 61_000;
    await service.getMatrix(pts, TUESDAY_9);
    expect(tomtom.calls).toBe(8);
    warn.mockRestore();
  });

  it("cache por par: repetir não consulta de novo; um local novo só pede os pares novos", async () => {
    const tomtom = fixtureProvider("tomtom");
    const service = createMatrixService({ providers: [tomtom], cache: new MemoryCache(), now: () => NOW });
    const three = pts.slice(0, 3);
    await service.getMatrix(three, TUESDAY_9);
    expect(tomtom.cells).toBe(9);
    await service.getMatrix(three, TUESDAY_9);
    expect(tomtom.cells).toBe(9);
    // Entra o 4º local: 6 pares novos (3 de ida, 3 de volta), em vez dos 16 da matriz inteira.
    await service.getMatrix(pts, TUESDAY_9);
    expect(tomtom.cells - 9).toBeLessThanOrEqual(8);
  });

  it("a chave do cache separa dia da semana e faixa de 15 minutos", async () => {
    const tomtom = fixtureProvider("tomtom");
    const service = createMatrixService({ providers: [tomtom], cache: new MemoryCache(), now: () => NOW });
    const at = (day: number, h: number, m: number) => new Date(Date.UTC(2026, 10, day, h, m));
    await service.getMatrix(pts, at(17, 9, 0));
    await service.getMatrix(pts, at(17, 9, 10)); // mesma faixa
    expect(tomtom.calls).toBe(1);
    await service.getMatrix(pts, at(17, 9, 20)); // outra faixa
    expect(tomtom.calls).toBe(2);
    await service.getMatrix(pts, at(18, 9, 0)); // outro dia da semana
    expect(tomtom.calls).toBe(3);
    await service.getMatrix(pts, at(24, 9, 5)); // terça seguinte, mesma faixa
    expect(tomtom.calls).toBe(3);
  });

  it("divide os pares que faltam em pedidos pequenos", () => {
    expect(planRequests([])).toEqual([]);
    // Local novo (índice 3) entre 4: linha nova + coluna nova.
    const missing: [number, number][] = [
      [3, 0],
      [3, 1],
      [3, 2],
      [0, 3],
      [1, 3],
      [2, 3],
    ];
    const requests = planRequests(missing);
    const cells = requests.reduce((sum, r) => sum + r.origins.length * r.destinations.length, 0);
    expect(cells).toBeLessThanOrEqual(8);
    for (const [i, j] of missing) {
      expect(requests.some((r) => r.origins.includes(i) && r.destinations.includes(j))).toBe(true);
    }
  });
});

describe("provedores reais (formato das requisições)", () => {
  it("TomTom Matrix v2: POST com origins/destinations, departAt e trânsito histórico", async () => {
    const bodies: { origins: unknown[]; destinations: unknown[]; options: Record<string, string> }[] = [];
    let url = "";
    const fetchFn = (async (u: string, init: RequestInit) => {
      url = u;
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      const data = [];
      for (let i = 0; i < body.origins.length; i++)
        for (let j = 0; j < body.destinations.length; j++)
          data.push({
            originIndex: i,
            destinationIndex: j,
            routeSummary: { travelTimeInSeconds: 100 * (i + 1) + j, lengthInMeters: 1000 },
          });
      return Response.json({ data });
    }) as typeof fetch;

    const provider = createTomTomMatrix("CHAVE", fetchFn, () => NOW);
    const block = await provider.getCells(pts, pts, TUESDAY_9, AbortSignal.timeout(1000));
    expect(url).toBe("https://api.tomtom.com/routing/matrix/2?key=CHAVE");
    expect(bodies[0].origins[0]).toEqual({ point: { latitude: P.B.lat, longitude: P.B.lng } });
    expect(bodies[0].options).toMatchObject({
      departAt: TUESDAY_9.toISOString(),
      traffic: "historical",
      travelMode: "car",
    });
    expect(block.seconds[2][3]).toBe(303);
    expect(block.meters?.[0][0]).toBe(1000);
  });

  it("TomTom: saída imediata usa departAt=now com trânsito ao vivo", async () => {
    let options: Record<string, string> = {};
    const fetchFn = (async (_u: string, init: RequestInit) => {
      options = JSON.parse(init.body as string).options;
      return Response.json({
        data: [{ originIndex: 0, destinationIndex: 0, routeSummary: { travelTimeInSeconds: 60 } }],
      });
    }) as typeof fetch;
    const provider = createTomTomMatrix("CHAVE", fetchFn, () => NOW);
    await provider.getCells([pts[0]], [pts[1]], new Date(NOW), AbortSignal.timeout(1000));
    expect(options).toMatchObject({ departAt: "now", traffic: "live" });
  });

  it("TomTom: divide em blocos de até 100 células", async () => {
    const sizes: number[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sizes.push(body.origins.length * body.destinations.length);
      const data = [];
      for (let i = 0; i < body.origins.length; i++)
        for (let j = 0; j < body.destinations.length; j++)
          data.push({ originIndex: i, destinationIndex: j, routeSummary: { travelTimeInSeconds: 1 } });
      return Response.json({ data });
    }) as typeof fetch;
    const many = Array.from({ length: 21 }, (_, i) => ({ lat: 38 + i * 0.01, lng: -9 }));
    const block = await createTomTomMatrix("CHAVE", fetchFn, () => NOW).getCells(
      many,
      many,
      TUESDAY_9,
      AbortSignal.timeout(1000),
    );
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(441);
    expect(block.seconds).toHaveLength(21);
  });

  it("TomTom: célula sem rota faz o provedor falhar (passa para o próximo)", async () => {
    const fetchFn = (async () =>
      Response.json({
        data: [{ originIndex: 0, destinationIndex: 0, detailedError: { code: "CELL_PROCESSING_ERROR" } }],
      })) as unknown as typeof fetch;
    await expect(
      createTomTomMatrix("CHAVE", fetchFn, () => NOW).getCells([pts[0]], [pts[1]], TUESDAY_9, AbortSignal.timeout(1000)),
    ).rejects.toThrow("incompleta");
  });

  it("OpenRouteService: locations em [lon, lat] e chave no cabeçalho", async () => {
    let seen: { url: string; auth: string; body: { locations: number[][]; sources: number[]; destinations: number[] } };
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = {
        url,
        auth: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(init.body as string),
      };
      return Response.json({ durations: [[448.82, 553.01]], distances: [[1000, 2000]] });
    }) as typeof fetch;
    const block = await createOrsMatrix("CHAVE-ORS", fetchFn).getCells(
      [pts[0]],
      [pts[1], pts[2]],
      TUESDAY_9,
      AbortSignal.timeout(1000),
    );
    expect(seen!.url).toBe("https://api.openrouteservice.org/v2/matrix/driving-car");
    expect(seen!.auth).toBe("CHAVE-ORS");
    expect(seen!.body.locations[0]).toEqual([P.B.lng, P.B.lat]);
    expect(seen!.body.sources).toEqual([0]);
    expect(seen!.body.destinations).toEqual([1, 2]);
    expect(block.seconds).toEqual([[449, 553]]);
  });

  it("estimativa: haversine × 1.4 ÷ 35 km/h", async () => {
    const block = await estimateProvider.getCells([pts[0]], [pts[0], pts[1]], TUESDAY_9, AbortSignal.timeout(1000));
    expect(block.seconds[0][0]).toBe(0);
    // ~12.7 km em linha reta → ~17.8 km de estrada → ~30 min.
    expect(block.seconds[0][1]).toBeGreaterThan(1700);
    expect(block.seconds[0][1]).toBeLessThan(1950);
  });
});

describe("geometria da rota (TomTom Calculate Route)", () => {
  const response = {
    routes: [
      {
        summary: { travelTimeInSeconds: 8000, lengthInMeters: 90_000 },
        legs: [
          { points: [{ latitude: 38.66, longitude: -9.07 }, { latitude: 38.64, longitude: -9.23 }] },
          { points: [{ latitude: 38.64, longitude: -9.23 }, { latitude: 38.69, longitude: -9.21 }] },
        ],
      },
    ],
  };

  it("monta a URL com os pontos em ordem e devolve a linha em [lng, lat]", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return Response.json(response);
    }) as typeof fetch;
    const service = createTomTomGeometry("CHAVE", new MemoryCache(), fetchFn, () => NOW);
    const route = await service.getRoute([pts[0], pts[3], pts[1]], TUESDAY_9);
    expect(urls[0]).toContain(
      "https://api.tomtom.com/routing/1/calculateRoute/38.661328,-9.075855:38.642175,-9.231557:38.696750,-9.214720/json?",
    );
    expect(urls[0]).toContain("traffic=true");
    expect(urls[0]).toContain("departAt=2026-11-17T09%3A00%3A00.000Z");
    expect(route?.coordinates[0]).toEqual([-9.07, 38.66]);
    expect(route?.coordinates).toHaveLength(4);
    expect(route?.seconds).toBe(8000);
    // Segunda vez vem do cache.
    await service.getRoute([pts[0], pts[3], pts[1]], TUESDAY_9);
    expect(urls).toHaveLength(1);
  });

  it("falha vira null (o mapa usa o traçado aproximado)", async () => {
    const warn = quiet();
    const fetchFn = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const service = createTomTomGeometry("CHAVE", new MemoryCache(), fetchFn, () => NOW);
    expect(await service.getRoute([pts[0], pts[1]], TUESDAY_9)).toBeNull();
    expect(await noGeometry.getRoute([pts[0], pts[1]], TUESDAY_9)).toBeNull();
    warn.mockRestore();
  });
});

describe("planejamento completo (POST /api/plan)", () => {
  const matrix = () =>
    createMatrixService({ providers: [fixtureProvider("tomtom")], cache: new MemoryCache(), now: () => NOW });
  const [B, Be, PN, CC] = pts;

  it("ida e volta: reordena, soma 7984 s e compara com a ordem digitada", async () => {
    const plan = await planRoute(
      { start: B, stops: [Be, PN, CC], end: null, roundTrip: true, mode: "depart", at: TUESDAY_9 },
      { matrix: matrix(), geometry: noGeometry, now: () => NOW },
    );
    expect(["CC,Be,PN", "PN,Be,CC"]).toContain(plan.order.join());
    expect(plan.totalSeconds).toBe(7984);
    expect(plan.typedSeconds).toBe(9419);
    expect(plan.legSeconds).toHaveLength(4);
    expect(plan.exact).toBe(true);
    expect(plan.source).toMatchObject({ name: "tomtom", trafficAware: true, estimated: false });
    expect(plan.departAt).toBe(TUESDAY_9.toISOString());
    expect(new Date(plan.arriveAt).getTime()).toBe(TUESDAY_9.getTime() + 7984_000);
    expect(plan.geometry).toBeNull();
    expect(plan.arrival).toBeNull();
  });

  it("fim escolhido e caminho aberto", async () => {
    const toEnd = await planRoute(
      { start: B, stops: [Be, CC], end: PN, roundTrip: false, mode: "depart", at: TUESDAY_9 },
      { matrix: matrix(), geometry: noGeometry, now: () => NOW },
    );
    expect(toEnd.order.join()).toBe("CC,Be");
    expect(toEnd.totalSeconds).toBe(2012 + 1493 + 1894);
    const open = await planRoute(
      { start: B, stops: [Be, PN, CC], end: null, roundTrip: false, mode: "depart", at: TUESDAY_9 },
      { matrix: matrix(), geometry: noGeometry, now: () => NOW },
    );
    expect(open.legSeconds).toHaveLength(3);
    expect(open.totalSeconds).toBe(2012 + 1493 + 1894);
  });

  it("Chegar até: a saída é a chegada menos a duração", async () => {
    const arriveAt = new Date(Date.UTC(2026, 10, 17, 12, 0));
    const plan = await planRoute(
      { start: B, stops: [Be, PN, CC], end: null, roundTrip: true, mode: "arrive", at: arriveAt },
      { matrix: matrix(), geometry: noGeometry, now: () => NOW },
    );
    expect(plan.arriveAt).toBe(arriveAt.toISOString());
    expect(new Date(plan.departAt).getTime()).toBe(arriveAt.getTime() - 7984_000);
    expect(plan.arrival?.converged).toBe(true);
    expect(plan.arrival?.iterations).toBeLessThanOrEqual(3);
  });

  it("sem paradas e com a geometria conferida", async () => {
    const geometry = {
      getRoute: async () => ({ coordinates: [[-9.07, 38.66], [-9.21, 38.69]] as [number, number][], seconds: 3100, meters: 20_000 }),
    };
    const plan = await planRoute(
      { start: B, stops: [], end: Be, roundTrip: false, mode: "depart", at: TUESDAY_9 },
      { matrix: matrix(), geometry, now: () => NOW },
    );
    expect(plan.order).toEqual([]);
    expect(plan.totalSeconds).toBe(3049);
    expect(plan.geometry).toHaveLength(2);
    expect(plan.checkedSeconds).toBe(3100);
  });

  it("o navegador envia só ids e coordenadas", () => {
    const body = planRequestBody({
      start: P.B,
      stops: [P.Be],
      end: P.PN,
      endSame: true,
      mode: "depart",
      dateTime: null,
    });
    expect(body).toEqual({
      start: { id: "B", lat: P.B.lat, lng: P.B.lng },
      stops: [{ id: "Be", lat: P.Be.lat, lng: P.Be.lng }],
      end: null,
      roundTrip: true,
      mode: "depart",
      at: null,
    });
    expect(JSON.stringify(body)).not.toContain("Barreiro");
  });
});
