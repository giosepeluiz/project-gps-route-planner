/**
 * Matriz de tempos com fallback: TomTom (matriz, com trânsito) → HERE (matriz,
 * com trânsito) → TomTom rota a rota (com trânsito) → OpenRouteService (sem
 * trânsito) → estimativa por distância. Quando a cota de um provedor acaba, ele
 * fica em pausa e a cadeia segue para o próximo, sem gastar chamadas à toa.
 *
 * Cota: o plano gratuito da TomTom tem poucas requisições de matriz por mês.
 * Por isso o cache é POR PAR de locais (origem → destino): ao adicionar uma
 * parada, só os pares novos são consultados.
 */
import { estimateSeconds, haversineMeters } from "../geo";
import { timeSlot } from "../solver";
import type { Cache } from "./cache";
import { CircuitBreaker, DefinitiveError, QuotaError, withPolicy } from "./resilience";

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

/**
 * Não existe caminho de carro entre dois locais (ex.: separados pelo mar).
 * Balsas não contam; pontes e túneis (inclusive trens de carros, como o
 * Eurotúnel), sim.
 */
export class NoRouteError extends DefinitiveError {
  constructor(
    readonly from?: Point,
    readonly to?: Point,
  ) {
    super("Não existe caminho de carro entre os locais.");
    this.name = "NoRouteError";
  }
}

type FetchFn = typeof fetch;

const round4 = (n: number) => n.toFixed(4);
const pointKey = (p: Point) => `${round4(p.lat)},${round4(p.lng)}`;

/** Trânsito ao vivo só faz sentido para saídas na próxima hora. */
const LIVE_WINDOW_MS = 60 * 60 * 1000;
export const isNearNow = (departAt: Date, now: number) => departAt.getTime() - now < LIVE_WINDOW_MS;

/** Pausa depois de um limite de cota (403 da TomTom, 401/403/429 da HERE): tenta de novo só depois de 1 h. */
export const QUOTA_PAUSE_S = 3600;
/** Pausa depois de excesso de ritmo (429 da TomTom: QPS ou fila de cálculo ocupada). */
export const RATE_PAUSE_S = 60;

/**
 * Status HTTP → erro. TomTom: 403 = chave inativa/sem direito/cota excedida, 429 = QPS ou recursos
 * em uso. HERE: 401/403 = chave inválida ou sem acesso, 429 = muitas requisições (cota).
 */
function httpError(provider: string, status: number): Error {
  if (provider === "tomtom" || provider === "tomtom-rota") {
    if (status === 403) return new QuotaError(provider, status, QUOTA_PAUSE_S);
    if (status === 429) return new QuotaError(provider, status, RATE_PAUSE_S);
  }
  if (provider === "here" && (status === 401 || status === 403 || status === 429)) {
    // 429 pode ser só ritmo: tenta de novo em 5 min; 401/403 (chave ou acesso): em 1 h.
    return new QuotaError(provider, status, status === 429 ? 300 : QUOTA_PAUSE_S);
  }
  return new Error(`HTTP ${status}`);
}

async function postJson(
  fetchFn: FetchFn,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
  provider = "",
) {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw httpError(provider, res.status);
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
    detailedError?: { innerError?: { code?: string } };
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
        // A Matrix v2 só aceita avoid "tollRoads" e "unpavedRoads" (com "ferries" responde 400).
        // A trava contra balsas fica no traçado de cada trecho (Calculate Route com avoid=ferries),
        // que recusa o plano quando não há caminho por terra, ponte ou túnel.
      };

      const seconds = emptyBlock(origins.length, destinations.length);
      const meters = emptyBlock(origins.length, destinations.length);
      const rowsPerRequest = Math.max(1, Math.floor(maxCells / destinations.length));

      const noRoute = (data: TomTomMatrixResponse) =>
        (data.data ?? []).some((cell) => cell.detailedError?.innerError?.code === "NO_ROUTE_FOUND");

      for (let from = 0; from < origins.length; from += rowsPerRequest) {
        const chunk = origins.slice(from, from + rowsPerRequest);
        const ask = (opts: typeof options) =>
          postJson(
            fetchFn,
            url,
            { origins: chunk.map(toPoint), destinations: destinations.map(toPoint), options: opts },
            {},
            signal,
            "tomtom",
          ) as Promise<TomTomMatrixResponse>;
        let data = await ask(options);
        // Com trânsito ao vivo, uma interdição momentânea (evento, obra) faz a TomTom
        // dizer NO_ROUTE_FOUND até de um ponto para ele mesmo. Antes de concluir que
        // não há caminho de carro, confere com o trânsito histórico do mesmo horário.
        if (live && noRoute(data)) {
          data = await ask({
            ...options,
            departAt: new Date(Math.max(departAt.getTime(), now() + 60_000)).toISOString(),
            traffic: "historical",
          });
        }
        for (const cell of data.data ?? []) {
          if (cell.detailedError?.innerError?.code === "NO_ROUTE_FOUND") {
            throw new NoRouteError(chunk[cell.originIndex], destinations[cell.destinationIndex]);
          }
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

      const seconds = origins.map((from, i) =>
        destinations.map((to, j) => {
          const value = data.durations?.[i]?.[j];
          // Célula nula = sem caminho entre os dois pontos.
          if (value === null && data.durations) throw new NoRouteError(from, to);
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

interface HereMatrixResponse {
  matrix?: {
    numOrigins: number;
    numDestinations: number;
    travelTimes?: number[];
    distances?: number[];
    errorCodes?: number[];
  };
}

/** Modo "Flexible" (região world) do HERE: até 15 origens × 100 destinos por pedido síncrono. */
const HERE_MAX_ORIGINS = 15;
const HERE_MAX_DESTINATIONS = 100;

/**
 * HERE Matrix Routing v8, síncrono, modo Flexible (regionDefinition world: rotas de qualquer
 * tamanho, com trânsito). POST https://matrix.router.hereapi.com/v8/matrix?async=false&apiKey=…
 * A resposta traz as matrizes achatadas: posição k = numDestinations × origem + destino.
 * errorCodes: 0 ok, 1 sem caminho, 2/4 não casou com a via, 3 rota com violação (o tempo vale).
 */
export function createHereMatrix(
  apiKey: string,
  fetchFn: FetchFn = fetch,
  now: () => number = Date.now,
): MatrixProvider {
  const url = `https://matrix.router.hereapi.com/v8/matrix?async=false&apiKey=${encodeURIComponent(apiKey)}`;
  const toPoint = (p: Point) => ({ lat: p.lat, lng: p.lng });
  return {
    name: "here",
    trafficAware: true,
    label: "HERE com trânsito",

    async getCells(origins, destinations, departAt, signal) {
      // Sem departureTime vale o trânsito de agora; com data, o previsto para aquele horário.
      const departureTime = departAt.getTime() - now() < 60_000 ? undefined : departAt.toISOString();
      const seconds = emptyBlock(origins.length, destinations.length);
      const meters = emptyBlock(origins.length, destinations.length);
      if (destinations.length > HERE_MAX_DESTINATIONS) throw new Error("here: destinos demais para um pedido.");

      for (let from = 0; from < origins.length; from += HERE_MAX_ORIGINS) {
        const chunk = origins.slice(from, from + HERE_MAX_ORIGINS);
        const data = (await postJson(
          fetchFn,
          url,
          {
            origins: chunk.map(toPoint),
            destinations: destinations.map(toPoint),
            regionDefinition: { type: "world" },
            transportMode: "car",
            routingMode: "fast",
            ...(departureTime ? { departureTime } : {}),
            matrixAttributes: ["travelTimes", "distances"],
          },
          {},
          signal,
          "here",
        )) as HereMatrixResponse;
        const matrix = data.matrix;
        if (!matrix || matrix.numOrigins !== chunk.length || matrix.numDestinations !== destinations.length) {
          throw new Error("here: resposta fora do formato.");
        }
        for (let i = 0; i < chunk.length; i++) {
          for (let j = 0; j < destinations.length; j++) {
            const k = matrix.numDestinations * i + j;
            const code = matrix.errorCodes?.[k] ?? 0;
            // 1 = grafo desconectado: não há caminho de carro entre os dois pontos.
            if (code === 1) throw new NoRouteError(chunk[i], destinations[j]);
            if (code !== 0 && code !== 3) continue;
            const time = matrix.travelTimes?.[k];
            if (typeof time !== "number") continue;
            seconds[from + i][j] = time;
            meters[from + i][j] = matrix.distances?.[k] ?? NaN;
          }
        }
      }
      assertComplete(seconds, "here");
      return { seconds, meters };
    },
  };
}

interface TomTomRouteResponse {
  routes?: { summary?: { travelTimeInSeconds?: number; lengthInMeters?: number } }[];
  detailedError?: { code?: string };
}

/** Pares por pedido de matriz: acima disso o rota a rota gastaria chamadas demais (o próximo da cadeia assume). */
export const PAIRWISE_MAX_PAIRS = 150;

/**
 * TomTom "simples": uma chamada de Calculate Route por par (com trânsito, só o resumo).
 * GET https://api.tomtom.com/routing/1/calculateRoute/lat,lng:lat,lng/json?routeRepresentation=summaryOnly
 * Usa a cota de rotas comuns da TomTom, que é separada da cota de matriz.
 */
export function createTomTomPairwise(
  apiKey: string,
  fetchFn: FetchFn = fetch,
  now: () => number = Date.now,
  maxPairs = PAIRWISE_MAX_PAIRS,
  concurrency = 4,
): MatrixProvider {
  return {
    name: "tomtom-rota",
    trafficAware: true,
    label: "TomTom com trânsito (rota a rota)",

    async getCells(origins, destinations, departAt, signal) {
      const pairs: [number, number][] = [];
      origins.forEach((a, i) =>
        destinations.forEach((b, j) => {
          if (a.lat !== b.lat || a.lng !== b.lng) pairs.push([i, j]);
        }),
      );
      if (pairs.length > maxPairs) throw new Error("tomtom-rota: pares demais para consultar um a um.");

      const seconds = emptyBlock(origins.length, destinations.length);
      const meters = emptyBlock(origins.length, destinations.length);
      for (let i = 0; i < origins.length; i++) {
        for (let j = 0; j < destinations.length; j++) {
          if (origins[i].lat === destinations[j].lat && origins[i].lng === destinations[j].lng) {
            seconds[i][j] = 0;
            meters[i][j] = 0;
          }
        }
      }

      let next = 0;
      const worker = async () => {
        while (next < pairs.length) {
          const [i, j] = pairs[next++];
          const a = origins[i];
          const b = destinations[j];
          const params = new URLSearchParams({
            key: apiKey,
            traffic: "true",
            travelMode: "car",
            routeType: "fastest",
            routeRepresentation: "summaryOnly",
            avoid: "ferries",
          });
          if (departAt.getTime() - now() >= 60_000) params.set("departAt", departAt.toISOString());
          const res = await fetchFn(
            `https://api.tomtom.com/routing/1/calculateRoute/${a.lat.toFixed(6)},${a.lng.toFixed(6)}:${b.lat.toFixed(6)},${b.lng.toFixed(6)}/json?${params}`,
            { signal, cache: "no-store" },
          );
          if (!res.ok) {
            // 400 com NO_ROUTE_FOUND = sem caminho de carro entre os dois pontos.
            if (res.status === 400 || res.status === 404) {
              const body = (await res.json().catch(() => null)) as TomTomRouteResponse | null;
              if (body?.detailedError?.code === "NO_ROUTE_FOUND") throw new NoRouteError(a, b);
            }
            throw httpError("tomtom-rota", res.status);
          }
          const body = (await res.json()) as TomTomRouteResponse;
          const summary = body.routes?.[0]?.summary;
          if (typeof summary?.travelTimeInSeconds !== "number") continue;
          seconds[i][j] = summary.travelTimeInSeconds;
          meters[i][j] = summary.lengthInMeters ?? NaN;
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker));
      assertComplete(seconds, "tomtom-rota");
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
  // Provedores em pausa por cota (também guardado no cache compartilhado, para todas as instâncias).
  const pausedUntil = new Map<string, number>();
  const pauseKey = (name: string) => `mx:pause:${name}`;
  const isPaused = async (name: string) => {
    if ((pausedUntil.get(name) ?? 0) > now()) return true;
    return (await cache.get<number>(pauseKey(name))) !== null;
  };
  const pause = async (name: string, seconds: number) => {
    pausedUntil.set(name, now() + seconds * 1000);
    await cache.set(pauseKey(name), 1, seconds);
  };

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
        // Cota acabada há pouco: nem tenta (economiza a chamada e o tempo de espera).
        if (!provider.local && (await isPaused(provider.name))) continue;
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
          // "Sem caminho" é resposta, não falha: não cai na estimativa em linha reta.
          if (err instanceof NoRouteError) throw err;
          // Cota esgotada: pausa o provedor e segue para o próximo da cadeia.
          if (err instanceof QuotaError) {
            await pause(provider.name, err.pauseSeconds);
            lastError = err;
            console.warn(`Matriz: ${err.message} Em pausa por ${Math.round(err.pauseSeconds / 60)} min.`);
            continue;
          }
          lastError = err;
          console.warn(`Matriz: ${provider.name} falhou, tentando o próximo.`, err);
        }
      }
      // A estimativa é local e não deveria falhar; se falhar, o erro sobe.
      throw lastError;
    },
  };
}
