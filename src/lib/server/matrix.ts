/**
 * Matriz de tempos com fallback: TomTom (com trânsito) → OpenRouteService
 * (sem trânsito) → estimativa por distância.
 *
 * Cota: o plano gratuito da TomTom tem poucas requisições de matriz por mês.
 * Por isso o cache é POR PAR de locais (origem → destino): ao adicionar uma
 * parada, só os pares novos são consultados.
 */
import { estimateSeconds, haversineMeters } from "../geo";
import { timeSlot } from "../solver";
import type { Cache } from "./cache";
import { CircuitBreaker, withPolicy } from "./resilience";

export interface Point {
  lat: number;
  lng: number;
}

export interface CellBlock {
  /** seconds[i][j] = tempo de origins[i] até destinations[j]. */
  seconds: number[][];
  meters?: number[][];
}

export interface MatrixProvider {
  name: string;
  trafficAware: boolean;
  /** Texto mostrado na interface como fonte dos dados. */
  label: string;
  /** Sem rede e sem custo: não passa por cache, timeout nem circuit breaker. */
  local?: boolean;
  getCells(
    origins: readonly Point[],
    destinations: readonly Point[],
    departAt: Date,
    signal: AbortSignal,
  ): Promise<CellBlock>;
}

export interface MatrixResult {
  seconds: number[][];
  meters?: number[][];
  /** Nome do provedor que respondeu. */
  source: string;
  label: string;
  trafficAware: boolean;
  /** true quando é a estimativa por distância (último recurso). */
  estimated: boolean;
}

type FetchFn = typeof fetch;

const round4 = (n: number) => n.toFixed(4);
const pointKey = (p: Point) => `${round4(p.lat)},${round4(p.lng)}`;

/** Trânsito ao vivo só faz sentido para saídas na próxima hora. */
const LIVE_WINDOW_MS = 60 * 60 * 1000;
export const isNearNow = (departAt: Date, now: number) => departAt.getTime() - now < LIVE_WINDOW_MS;

async function postJson(fetchFn: FetchFn, url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal) {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const emptyBlock = (rows: number, cols: number) =>
  Array.from({ length: rows }, () => new Array<number>(cols).fill(NaN));

function assertComplete(block: number[][], provider: string) {
  if (block.some((row) => row.some((v) => !Number.isFinite(v)))) {
    throw new Error(`${provider}: matriz incompleta (algum trecho sem rota).`);
  }
}

interface TomTomMatrixResponse {
  data?: {
    originIndex: number;
    destinationIndex: number;
    routeSummary?: { travelTimeInSeconds?: number; lengthInMeters?: number };
  }[];
}

/**
 * TomTom Matrix Routing v2, síncrono.
 * POST https://api.tomtom.com/routing/matrix/2?key=…
 * O limite síncrono é de 100 células por requisição no plano comum, então a
 * matriz é pedida em blocos.
 */
export function createTomTomMatrix(
  apiKey: string,
  fetchFn: FetchFn = fetch,
  now: () => number = Date.now,
  maxCells = 100,
): MatrixProvider {
  const url = `https://api.tomtom.com/routing/matrix/2?key=${encodeURIComponent(apiKey)}`;
  const toPoint = (p: Point) => ({ point: { latitude: p.lat, longitude: p.lng } });

  return {
    name: "tomtom",
    trafficAware: true,
    label: "TomTom com trânsito",

    async getCells(origins, destinations, departAt, signal) {
      // departAt precisa estar no futuro; para saídas imediatas vale "now" com trânsito ao vivo.
      const live = isNearNow(departAt, now());
      const options = {
        departAt: departAt.getTime() - now() < 60_000 ? "now" : departAt.toISOString(),
        traffic: live ? "live" : "historical",
        routeType: "fastest",
        travelMode: "car",
      };

      const seconds = emptyBlock(origins.length, destinations.length);
      const meters = emptyBlock(origins.length, destinations.length);
      const rowsPerRequest = Math.max(1, Math.floor(maxCells / destinations.length));

      for (let from = 0; from < origins.length; from += rowsPerRequest) {
        const chunk = origins.slice(from, from + rowsPerRequest);
        const data = (await postJson(
          fetchFn,
          url,
          { origins: chunk.map(toPoint), destinations: destinations.map(toPoint), options },
          {},
          signal,
        )) as TomTomMatrixResponse;
        for (const cell of data.data ?? []) {
          const time = cell.routeSummary?.travelTimeInSeconds;
          if (typeof time !== "number") continue;
          seconds[from + cell.originIndex][cell.destinationIndex] = time;
          meters[from + cell.originIndex][cell.destinationIndex] = cell.routeSummary?.lengthInMeters ?? NaN;
        }
      }
      assertComplete(seconds, "tomtom");
      return { seconds, meters };
    },
  };
}

interface OrsMatrixResponse {
  durations?: (number | null)[][];
  distances?: (number | null)[][];
}

/**
 * OpenRouteService (reserva, SEM trânsito).
 * POST https://api.openrouteservice.org/v2/matrix/driving-car, com a chave no
 * cabeçalho Authorization. Coordenadas em [lon, lat].
 */
export function createOrsMatrix(apiKey: string, fetchFn: FetchFn = fetch): MatrixProvider {
  return {
    name: "openrouteservice",
    trafficAware: false,
    label: "OpenRouteService, sem previsão de trânsito",

    async getCells(origins, destinations, _departAt, signal) {
      const locations = [...origins, ...destinations].map((p) => [p.lng, p.lat]);
      const data = (await postJson(
        fetchFn,
        "https://api.openrouteservice.org/v2/matrix/driving-car",
        {
          locations,
          sources: origins.map((_, i) => i),
          destinations: destinations.map((_, i) => origins.length + i),
          metrics: ["duration", "distance"],
        },
        { Authorization: apiKey },
        signal,
      )) as OrsMatrixResponse;

      const seconds = origins.map((_, i) =>
        destinations.map((_, j) => {
          const value = data.durations?.[i]?.[j];
          return typeof value === "number" ? Math.round(value) : NaN;
        }),
      );
      assertComplete(seconds, "openrouteservice");
      const meters = data.distances
        ? origins.map((_, i) => destinations.map((_, j) => data.distances?.[i]?.[j] ?? NaN))
        : undefined;
      return { seconds, meters };
    },
  };
}

/** Último recurso: haversine × 1.4 ÷ 35 km/h. Sempre rotulado como estimativa. */
export const estimateProvider: MatrixProvider = {
  name: "estimativa",
  trafficAware: false,
  label: "Estimativa por distância, sem previsão de trânsito",
  local: true,
  async getCells(origins, destinations) {
    return {
      seconds: origins.map((a) => destinations.map((b) => estimateSeconds(a, b))),
      meters: origins.map((a) => destinations.map((b) => Math.round(haversineMeters(a, b) * 1.4))),
    };
  },
};

export interface MatrixService {
  getMatrix(points: readonly Point[], departAt: Date): Promise<MatrixResult>;
}

export interface MatrixServiceOptions {
  /** Em ordem de preferência. A estimativa entra sozinha no fim. */
  providers: MatrixProvider[];
  cache: Cache;
  timeoutMs?: number;
  retries?: number;
  now?: () => number;
}

interface CachedCell {
  s: number;
  m?: number;
}

const HISTORICAL_TTL_S = 7 * 24 * 3600;
const LIVE_TTL_S = 15 * 60;

/**
 * Divide os pares que faltam em até dois pedidos retangulares, para não pedir
 * a matriz inteira quando só entrou um local novo:
 * 1) as origens com muitos destinos faltando × esses destinos;
 * 2) o que sobrar: origens restantes × destinos restantes.
 */
export function planRequests(
  missing: readonly (readonly [number, number])[],
): { origins: number[]; destinations: number[] }[] {
  if (missing.length === 0) return [];
  const byOrigin = new Map<number, Set<number>>();
  const allDestinations = new Set<number>();
  for (const [i, j] of missing) {
    if (!byOrigin.has(i)) byOrigin.set(i, new Set());
    byOrigin.get(i)!.add(j);
    allDestinations.add(j);
  }
  const heavy = [...byOrigin].filter(([, dests]) => dests.size > allDestinations.size / 2);
  const light = [...byOrigin].filter(([, dests]) => dests.size <= allDestinations.size / 2);

  const requests: { origins: number[]; destinations: number[] }[] = [];
  for (const group of [heavy, light]) {
    if (group.length === 0) continue;
    const destinations = new Set<number>();
    for (const [, dests] of group) dests.forEach((d) => destinations.add(d));
    requests.push({ origins: group.map(([origin]) => origin), destinations: [...destinations] });
  }
  return requests;
}

export function createMatrixService({
  providers,
  cache,
  timeoutMs = 8000,
  retries = 1,
  now = Date.now,
}: MatrixServiceOptions): MatrixService {
  const chain = [...providers.filter((p) => !p.local), estimateProvider];
  const breakers = new Map(chain.map((p) => [p.name, new CircuitBreaker(p.name, 3, 60_000, now)]));

  async function fromProvider(provider: MatrixProvider, points: readonly Point[], departAt: Date) {
    const n = points.length;
    const seconds = emptyBlock(n, n);
    const meters = emptyBlock(n, n);
    for (let i = 0; i < n; i++) {
      seconds[i][i] = 0;
      meters[i][i] = 0;
    }

    if (provider.local) {
      const block = await provider.getCells(points, points, departAt, AbortSignal.timeout(timeoutMs));
      return { seconds: block.seconds, meters: block.meters };
    }

    // Chave: coordenadas (4 casas) + dia da semana + faixa de 15 min + provedor.
    // Com trânsito ao vivo, a faixa é a do instante real e o cache dura 15 min.
    const live = provider.trafficAware && isNearNow(departAt, now());
    const slot = provider.trafficAware
      ? live
        ? `live:${timeSlot(departAt)}`
        : `${departAt.getUTCDay()}:${timeSlot(departAt) % 96}`
      : "-";
    const ttl = live ? LIVE_TTL_S : HISTORICAL_TTL_S;
    // Uma entrada de cache por ORIGEM (com todos os destinos já conhecidos),
    // para não fazer centenas de leituras num cache remoto.
    const rowKey = (i: number) => `mx:v1:${provider.name}:${slot}:${pointKey(points[i])}`;
    const rows = await Promise.all(
      points.map(async (_, i) => (await cache.get<Record<string, CachedCell>>(rowKey(i))) ?? {}),
    );

    const missing: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const hit = rows[i][pointKey(points[j])];
        if (hit) {
          seconds[i][j] = hit.s;
          meters[i][j] = hit.m ?? NaN;
        } else {
          missing.push([i, j]);
        }
      }
    }

    const breaker = breakers.get(provider.name)!;
    const changed = new Set<number>();
    for (const request of planRequests(missing)) {
      const block = await withPolicy(
        breaker,
        (signal) =>
          provider.getCells(
            request.origins.map((i) => points[i]),
            request.destinations.map((j) => points[j]),
            departAt,
            signal,
          ),
        { timeoutMs, retries },
      );
      request.origins.forEach((i, a) =>
        request.destinations.forEach((j, b) => {
          if (i === j) return;
          const s = block.seconds[a]?.[b];
          if (!Number.isFinite(s)) return;
          const m = block.meters?.[a]?.[b];
          seconds[i][j] = s;
          meters[i][j] = m ?? NaN;
          rows[i][pointKey(points[j])] = Number.isFinite(m) ? { s, m } : { s };
          changed.add(i);
        }),
      );
    }
    await Promise.all([...changed].map((i) => cache.set(rowKey(i), rows[i], ttl)));

    assertComplete(seconds, provider.name);
    const hasMeters = meters.every((row) => row.every((v) => Number.isFinite(v)));
    return { seconds, meters: hasMeters ? meters : undefined };
  }

  return {
    async getMatrix(points, departAt) {
      let lastError: unknown;
      for (const provider of chain) {
        try {
          const { seconds, meters } = await fromProvider(provider, points, departAt);
          return {
            seconds,
            meters,
            source: provider.name,
            label: provider.label,
            trafficAware: provider.trafficAware,
            estimated: provider.local === true,
          };
        } catch (err) {
          lastError = err;
          console.warn(`Matriz: ${provider.name} falhou, tentando o próximo.`, err);
        }
      }
      // A estimativa é local e não deveria falhar; se falhar, o erro sobe.
      throw lastError;
    },
  };
}
