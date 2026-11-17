import { describe, expect, it, vi } from "vitest";
import { FIXTURE_PLACES as P, fixtureSeconds } from "./mock-data";
import { fetchPlan, planRequestBody } from "./plan-client";
import { MemoryCache } from "./server/cache";
import {
  createMatrixService,
  createOrsMatrix,
  createTomTomMatrix,
  estimateProvider,
  NoRouteError,
  planRequests,
  type MatrixProvider,
  type Point,
} from "./server/matrix";
import { planRoute, type PlanPoint } from "./server/plan";
import {
  chainGeometry,
  createOsrmDemoGeometry,
  createTomTomGeometry,
  noGeometry,
  splitLine,
  type RouteGeometry,
} from "./server/route-geometry";

/** Nos testes de geometria, a resposta esperada é sempre uma rota. */
const geo = (route: unknown) => route as RouteGeometry;
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
          {
            summary: { travelTimeInSeconds: 2000, lengthInMeters: 30_000 },
            points: [{ latitude: 38.66, longitude: -9.07 }, { latitude: 38.64, longitude: -9.23 }],
          },
          {
            summary: { travelTimeInSeconds: 6000, lengthInMeters: 60_000 },
            points: [{ latitude: 38.64, longitude: -9.23 }, { latitude: 38.69, longitude: -9.21 }],
          },
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
    expect(geo(route).legs).toHaveLength(2);
    expect(geo(route).legs[0].coordinates[0]).toEqual([-9.07, 38.66]);
    expect(geo(route).legs[0]).toMatchObject({ seconds: 2000, meters: 30_000 });
    expect(geo(route).seconds).toBe(8000);
    expect(geo(route).meters).toBe(90_000);
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

describe("sem travessia por mar", () => {
  const oceanProvider = (): MatrixProvider & { calls: number } => {
    const provider = {
      name: "tomtom",
      trafficAware: true,
      label: "TomTom com trânsito",
      calls: 0,
      async getCells(origins: readonly Point[], destinations: readonly Point[]): Promise<never> {
        provider.calls += 1;
        throw new NoRouteError(origins[0], destinations[0]);
      },
    };
    return provider;
  };

  it("'sem caminho' é resposta definitiva: sem retry e sem cair na estimativa em linha reta", async () => {
    const tomtom = oceanProvider();
    const ors = fixtureProvider("openrouteservice");
    const service = createMatrixService({ providers: [tomtom, ors], cache: new MemoryCache(), now: () => NOW });
    await expect(service.getMatrix(pts, TUESDAY_9)).rejects.toBeInstanceOf(NoRouteError);
    expect(tomtom.calls).toBe(1);
    expect(ors.calls).toBe(0);
    // E não conta como falha: o circuito continua fechado.
    await expect(service.getMatrix(pts, TUESDAY_9)).rejects.toBeInstanceOf(NoRouteError);
    expect(tomtom.calls).toBe(2);
  });

  it("TomTom: não manda avoid inválido para a Matrix v2 e reconhece NO_ROUTE_FOUND", async () => {
    let avoid: unknown = "não lido";
    const fetchFn = (async (_u: string, init: RequestInit) => {
      avoid = JSON.parse(init.body as string).options.avoid;
      return Response.json({
        data: [
          {
            originIndex: 0,
            destinationIndex: 0,
            detailedError: { code: "CELL_PROCESSING_ERROR", innerError: { code: "NO_ROUTE_FOUND" } },
          },
        ],
      });
    }) as typeof fetch;
    const error = await createTomTomMatrix("CHAVE", fetchFn, () => NOW)
      .getCells([pts[0]], [pts[1]], TUESDAY_9, AbortSignal.timeout(1000))
      .catch((e: unknown) => e);
    // A Matrix v2 responde 400 para avoid "ferries"; a trava de balsas fica no traçado.
    expect(avoid).toBeUndefined();
    expect(error).toBeInstanceOf(NoRouteError);
    expect((error as NoRouteError).from).toBe(pts[0]);
    expect((error as NoRouteError).to).toBe(pts[1]);
  });

  it("TomTom: NO_ROUTE_FOUND com trânsito ao vivo é conferido com o histórico antes de valer", async () => {
    const asked: string[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const { traffic } = JSON.parse(init.body as string).options;
      asked.push(traffic);
      // Ao vivo: interdição momentânea. Histórico: caminho normal.
      return Response.json({
        data: [
          traffic === "live"
            ? { originIndex: 0, destinationIndex: 0, detailedError: { innerError: { code: "NO_ROUTE_FOUND" } } }
            : { originIndex: 0, destinationIndex: 0, routeSummary: { travelTimeInSeconds: 900, lengthInMeters: 9000 } },
        ],
      });
    }) as typeof fetch;
    const result = await createTomTomMatrix("CHAVE", fetchFn, () => NOW).getCells(
      [pts[0]],
      [pts[1]],
      new Date(NOW),
      AbortSignal.timeout(1000),
    );
    expect(asked).toEqual(["live", "historical"]);
    expect(result.seconds[0][0]).toBe(900);
  });

  it("OpenRouteService: célula nula vira 'sem caminho'", async () => {
    const fetchFn = (async () => Response.json({ durations: [[null]] })) as unknown as typeof fetch;
    await expect(
      createOrsMatrix("CHAVE", fetchFn).getCells([pts[0]], [pts[1]], TUESDAY_9, AbortSignal.timeout(1000)),
    ).rejects.toBeInstanceOf(NoRouteError);
  });

  it("rota pelas ruas: evita balsas e devolve 'no-route' quando não há caminho", async () => {
    const urls: string[] = [];
    const osrm = createOsrmDemoGeometry(new MemoryCache(), (async (url: string) => {
      urls.push(url);
      return Response.json({ code: "NoRoute", message: "Impossible route between points" }, { status: 400 });
    }) as typeof fetch);
    expect(await osrm.getRoute([pts[0], pts[1]], TUESDAY_9)).toBe("no-route");

    // Ponto longe de qualquer estrada (o OSRM o "encaixa" a milhares de km).
    const snapped = createOsrmDemoGeometry(new MemoryCache(), (async () =>
      Response.json({
        code: "Ok",
        routes: [{ geometry: { coordinates: [[-9.07, 38.66], [-9.2, 38.7]] }, legs: [{ duration: 3000, distance: 60000 }] }],
        waypoints: [{ location: [-9.07, 38.66], distance: 12 }, { location: [-9.2, 38.7], distance: 5_400_000 }],
      })) as unknown as typeof fetch);
    expect(await snapped.getRoute([pts[0], { lat: 40.7128, lng: -74.006 }], TUESDAY_9)).toBe("no-route");

    const tomtom = createTomTomGeometry(
      "CHAVE",
      new MemoryCache(),
      (async (url: string) => {
        urls.push(url);
        return Response.json({ routes: [] });
      }) as typeof fetch,
      () => NOW,
    );
    await tomtom.getRoute([pts[0], pts[1]], TUESDAY_9);
    expect(urls[1]).toContain("avoid=ferries");
    expect(urls[1]).toContain("sectionType=ferry");
  });

  it("TomTom: rota só possível de balsa vira 'no-route'; trem de carros (Eurotúnel) vale", async () => {
    const leg = {
      summary: { travelTimeInSeconds: 9000, lengthInMeters: 180_000 },
      points: [
        { latitude: -22.9, longitude: -43.17 },
        { latitude: -23.14, longitude: -44.16 },
      ],
    };
    const answer = (body: unknown, status = 200) =>
      createTomTomGeometry("CHAVE", new MemoryCache(), (async () => Response.json(body, { status })) as unknown as typeof fetch, () => NOW);

    // O avoid=ferries é só preferência: sem alternativa, a TomTom devolve a rota com a seção FERRY.
    const ferry = answer({ routes: [{ legs: [leg], sections: [{ sectionType: "FERRY" }] }] });
    expect(await ferry.getRoute([pts[0], pts[1]], TUESDAY_9)).toBe("no-route");

    // Sem caminho nenhum, ela responde 400 com NO_ROUTE_FOUND.
    const none = answer({ detailedError: { code: "NO_ROUTE_FOUND", message: "No valid route found" } }, 400);
    expect(await none.getRoute([pts[0], pts[1]], TUESDAY_9)).toBe("no-route");

    const train = answer({ routes: [{ legs: [leg], sections: [{ sectionType: "CAR_TRAIN" }] }] });
    const route = await train.getRoute([pts[0], pts[1]], TUESDAY_9);
    expect(route && route !== "no-route" ? route.meters : null).toBe(180_000);
  });

  it("permanência nas paradas: antecipa a saída no Chegar até e soma na chegada", async () => {
    const deps = {
      matrix: createMatrixService({ providers: [], cache: new MemoryCache() }),
      geometry: { getRoute: async () => null },
      now: () => NOW,
    };
    const request = { start: pts[0], end: null, roundTrip: true, mode: "arrive" as const, at: TUESDAY_9 };
    const without = await planRoute({ ...request, stops: [pts[1]] }, deps);
    const withDwell = await planRoute({ ...request, stops: [{ ...pts[1], dwellMin: 30 }] }, deps);
    expect(withDwell.dwellSeconds).toBe(30 * 60);
    expect(withDwell.totalSeconds).toBe(without.totalSeconds);
    expect(new Date(withDwell.arriveAt).getTime()).toBe(TUESDAY_9.getTime());
    expect(new Date(without.departAt).getTime() - new Date(withDwell.departAt).getTime()).toBe(30 * 60_000);
  });

  it("o plano falha com NoRouteError mesmo quando os tempos vêm da estimativa", async () => {
    await expect(
      planRoute(
        { start: pts[0], stops: [pts[1]], end: null, roundTrip: true, mode: "depart", at: TUESDAY_9 },
        {
          matrix: createMatrixService({ providers: [], cache: new MemoryCache() }),
          geometry: { getRoute: async () => "no-route" as const },
          now: () => NOW,
        },
      ),
    ).rejects.toBeInstanceOf(NoRouteError);
  });

  it("o navegador recebe o aviso com os dois locais", async () => {
    const fetchFn = (async () =>
      Response.json({ error: "no_route", fromId: "B", toId: "Be" }, { status: 422 })) as unknown as typeof fetch;
    expect(await fetchPlan("{}", AbortSignal.timeout(1000), fetchFn)).toEqual({
      kind: "no-route",
      fromId: "B",
      toId: "Be",
    });
    const down = (async () => new Response("", { status: 502 })) as unknown as typeof fetch;
    expect(await fetchPlan("{}", AbortSignal.timeout(1000), down)).toEqual({ kind: "failed" });
  });
});

describe("rota pelas ruas: OSRM demo e cadeia", () => {
  it("corta a linha inteira nos pontos das paradas", () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    const pieces = splitLine(line, [
      [0, 0],
      [2, 0],
      [4, 0],
    ]);
    expect(pieces).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      [
        [2, 0],
        [3, 0],
        [4, 0],
      ],
    ]);
  });

  it("OSRM: longitude primeiro na URL e um trecho por perna", async () => {
    let seenUrl = "";
    const fetchFn = (async (url: string) => {
      seenUrl = url;
      return Response.json({
        code: "Ok",
        routes: [
          {
            geometry: { coordinates: [[-9.07, 38.66], [-9.15, 38.65], [-9.23, 38.64], [-9.22, 38.67], [-9.21, 38.69]] },
            legs: [
              { duration: 1500.4, distance: 21000 },
              { duration: 700, distance: 8000 },
            ],
          },
        ],
        waypoints: [{ location: [-9.07, 38.66] }, { location: [-9.23, 38.64] }, { location: [-9.21, 38.69] }],
      });
    }) as typeof fetch;
    const route = await createOsrmDemoGeometry(new MemoryCache(), fetchFn).getRoute(
      [pts[0], pts[3], pts[1]],
      TUESDAY_9,
    );
    expect(seenUrl).toContain("https://router.project-osrm.org/route/v1/driving/-9.075855,38.661328;");
    expect(geo(route).legs).toHaveLength(2);
    expect(geo(route).legs[0]).toMatchObject({ seconds: 1500, meters: 21000 });
    expect(geo(route).legs[0].coordinates).toHaveLength(3);
    expect(geo(route).legs[1].coordinates).toHaveLength(3);
    expect(geo(route).seconds).toBe(2200);
  });

  it("a cadeia fica com o primeiro serviço que responder", async () => {
    const answer = { legs: [], seconds: 1, meters: 1, source: "segundo" };
    const chain = chainGeometry([noGeometry, { getRoute: async () => answer }]);
    expect(await chain.getRoute([pts[0], pts[1]], TUESDAY_9)).toBe(answer);
    expect(await chainGeometry([]).getRoute([pts[0], pts[1]], TUESDAY_9)).toBeNull();
  });
});

describe("planejamento completo (POST /api/plan)", () => {
  it("local travado: fica na posição dele e os outros são otimizados em volta", async () => {
    const [B, Be, PN, CC] = pts;
    const plan = await planRoute(
      // Belém travado como 1ª parada (a melhor ordem livre começa por CC ou PN).
      { start: B, stops: [Be, PN, CC], end: null, roundTrip: true, locks: { Be: 0 }, mode: "depart", at: TUESDAY_9 },
      {
        matrix: createMatrixService({ providers: [fixtureProvider("tomtom")], cache: new MemoryCache(), now: () => NOW }),
        geometry: noGeometry,
        now: () => NOW,
      },
    );
    // Com Belém em 1º: (Be, PN, CC) dá 9419 s e (Be, CC, PN) dá 9591 s.
    expect(plan.order).toEqual(["Be", "PN", "CC"]);
    expect(plan.totalSeconds).toBe(9419);
    expect(plan.bestSeconds).toBe(7984);
    expect(plan.lockedCount).toBe(1);
  });

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
    expect(plan.streetLegs).toBeNull();
    expect(plan.bestSeconds).toBe(7984);
    expect(plan.lockedCount).toBe(0);
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
      getRoute: async () => ({
        legs: [{ coordinates: [[-9.07, 38.66], [-9.21, 38.69]] as [number, number][], seconds: 3100, meters: 20_000 }],
        seconds: 3100,
        meters: 20_000,
        source: "TomTom",
      }),
    };
    const plan = await planRoute(
      { start: B, stops: [], end: Be, roundTrip: false, mode: "depart", at: TUESDAY_9 },
      { matrix: matrix(), geometry, now: () => NOW },
    );
    expect(plan.order).toEqual([]);
    expect(plan.totalSeconds).toBe(3049);
    expect(plan.streetLegs).toHaveLength(1);
    expect(plan.streetSource).toBe("TomTom");
    expect(plan.checkedSeconds).toBe(3100);
  });

  it("o navegador envia só ids e coordenadas", () => {
    const body = planRequestBody({
      start: P.B,
      stops: [P.Be],
      end: P.PN,
      endSame: true,
      locks: {},
      mode: "depart",
      dateTime: null,
    });
    expect(body).toEqual({
      start: { id: "B", lat: P.B.lat, lng: P.B.lng },
      stops: [{ id: "Be", lat: P.Be.lat, lng: P.Be.lng }],
      end: null,
      roundTrip: true,
      locks: {},
      mode: "depart",
      at: null,
    });
    expect(JSON.stringify(body)).not.toContain("Barreiro");
  });
});
