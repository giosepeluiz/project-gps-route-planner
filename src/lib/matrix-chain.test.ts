import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "./server/cache";
import {
  createHereMatrix,
  createMatrixService,
  createOrsMatrix,
  createTomTomMatrix,
  createTomTomPairwise,
} from "./server/matrix";

const NOW = Date.UTC(2026, 10, 24, 9, 0);
const pts = [
  { lat: 38.72, lng: -9.14 },
  { lat: 38.73, lng: -9.15 },
  { lat: 38.74, lng: -9.16 },
];
const DEPART = new Date(NOW + 24 * 3600_000);
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Resposta do HERE: matrizes achatadas, posição k = numDestinations × origem + destino. */
const hereBody = (n: number, base: number) => ({
  matrix: {
    numOrigins: n,
    numDestinations: n,
    travelTimes: Array.from({ length: n * n }, (_, k) => (Math.floor(k / n) === k % n ? 0 : base + k)),
    distances: Array.from({ length: n * n }, (_, k) => (Math.floor(k / n) === k % n ? 0 : 1000 * (base + k))),
  },
});

describe("cadeia da matriz: TomTom → HERE → TomTom rota a rota → ORS", () => {
  it("HERE: pedido no modo Flexible (world), com a chave na URL, e leitura da matriz achatada", async () => {
    const fetchFn = vi.fn(async () => json(hereBody(3, 100)));
    const here = createHereMatrix("CHAVE", fetchFn as unknown as typeof fetch, () => NOW);
    const block = await here.getCells(pts, pts, DEPART, AbortSignal.timeout(1000));
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://matrix.router.hereapi.com/v8/matrix?async=false&apiKey=CHAVE");
    const body = JSON.parse(String(init.body));
    expect(body.regionDefinition).toEqual({ type: "world" });
    expect(body.transportMode).toBe("car");
    expect(body.departureTime).toBe(DEPART.toISOString());
    expect(body.origins[0]).toEqual({ lat: 38.72, lng: -9.14 });
    // k = 3 × origem + destino: origem 1 → destino 2 = posição 5 = 100 + 5.
    expect(block.seconds[1][2]).toBe(105);
    expect(block.meters?.[0][1]).toBe(101_000);
  });

  it("HERE: mais de 15 origens viram vários pedidos (limite do modo Flexible)", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ lat: 38 + i * 0.01, lng: -9 }));
    const fetchFn = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const n = body.origins.length;
      const m = body.destinations.length;
      return json({ matrix: { numOrigins: n, numDestinations: m, travelTimes: new Array(n * m).fill(60) } });
    });
    const here = createHereMatrix("K", fetchFn as unknown as typeof fetch, () => NOW);
    const block = await here.getCells(many, many, DEPART, AbortSignal.timeout(1000));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(block.seconds).toHaveLength(20);
  });

  it("quando a TomTom (403) acaba, usa a HERE; e a TomTom fica em pausa (não é chamada de novo)", async () => {
    const tomtomFetch = vi.fn(async () => new Response("quota", { status: 403 }));
    const hereFetch = vi.fn(async () => json(hereBody(3, 50)));
    const service = createMatrixService({
      providers: [
        createTomTomMatrix("T", tomtomFetch as unknown as typeof fetch, () => NOW),
        createHereMatrix("H", hereFetch as unknown as typeof fetch, () => NOW),
      ],
      cache: new MemoryCache(),
      now: () => NOW,
      retries: 0,
    });
    const first = await service.getMatrix(pts, DEPART);
    expect(first.source).toBe("here");
    expect(first.trafficAware).toBe(true);
    expect(tomtomFetch).toHaveBeenCalledTimes(1);
    // Pontos novos (cache não serve): a TomTom está em pausa e nem é consultada.
    await service.getMatrix([...pts, { lat: 38.75, lng: -9.17 }], DEPART).catch(() => null);
    expect(tomtomFetch).toHaveBeenCalledTimes(1);
  });

  it("sem cota na TomTom e na HERE: TomTom rota a rota; depois, ORS (sem trânsito)", async () => {
    const quota = async () => new Response("x", { status: 429 });
    const route = vi.fn(async (url: unknown) => {
      const u = String(url);
      expect(u).toContain("routeRepresentation=summaryOnly");
      return json({ routes: [{ summary: { travelTimeInSeconds: 600, lengthInMeters: 5000 } }] });
    });
    const withPairwise = createMatrixService({
      providers: [
        createTomTomMatrix("T", quota as unknown as typeof fetch, () => NOW),
        createHereMatrix("H", quota as unknown as typeof fetch, () => NOW),
        createTomTomPairwise("T", route as unknown as typeof fetch, () => NOW),
      ],
      cache: new MemoryCache(),
      now: () => NOW,
      retries: 0,
    });
    const result = await withPairwise.getMatrix(pts, DEPART);
    expect(result.source).toBe("tomtom-rota");
    expect(result.seconds[0][1]).toBe(600);
    expect(route).toHaveBeenCalledTimes(6); // 3 × 2 pares

    // Se o rota a rota também acabar, o ORS (sem trânsito) assume.
    const ors = vi.fn(async () => json({ durations: [[0, 70, 80], [70, 0, 90], [80, 90, 0]], distances: [[0, 1, 1], [1, 0, 1], [1, 1, 0]] }));
    const lastResort = createMatrixService({
      providers: [
        createTomTomMatrix("T", quota as unknown as typeof fetch, () => NOW),
        createHereMatrix("H", quota as unknown as typeof fetch, () => NOW),
        createTomTomPairwise("T", quota as unknown as typeof fetch, () => NOW),
        createOrsMatrix("O", ors as unknown as typeof fetch),
      ],
      cache: new MemoryCache(),
      now: () => NOW,
      retries: 0,
    });
    const final = await lastResort.getMatrix(pts, DEPART);
    expect(final.source).toBe("openrouteservice");
    expect(final.trafficAware).toBe(false);
  });

  it("rota a rota recusa matrizes grandes (deixa para o próximo da cadeia)", async () => {
    const big = Array.from({ length: 14 }, (_, i) => ({ lat: 38 + i * 0.01, lng: -9 }));
    const route = vi.fn();
    const pairwise = createTomTomPairwise("T", route as unknown as typeof fetch, () => NOW);
    await expect(pairwise.getCells(big, big, DEPART, AbortSignal.timeout(1000))).rejects.toThrow(/pares demais/);
    expect(route).not.toHaveBeenCalled();
  });
});
