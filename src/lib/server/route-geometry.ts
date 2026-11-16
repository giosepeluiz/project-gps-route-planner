/**
 * Geometria da rota final, trecho a trecho, para desenhar a linha pelas ruas
 * e conferir tempo e distância.
 *
 * - TomTom Calculate Route (principal):
 *   GET https://api.tomtom.com/routing/1/calculateRoute/{lat,lon:lat,lon…}/json
 * - Servidor demo público do OSRM: SÓ em desenvolvimento, quando não há chave
 *   da TomTom. A política dele não permite uso em produção.
 */
import { haversineMeters } from "../geo";
import { timeSlot } from "../solver";
import type { Cache } from "./cache";
import { isNearNow, type Point } from "./matrix";
import { CircuitBreaker, withPolicy } from "./resilience";

export interface RouteLeg {
  /** Linha do trecho em [lng, lat]. */
  coordinates: [number, number][];
  seconds: number;
  meters: number;
}

export interface RouteGeometry {
  /** Um item por trecho (início → parada 1, parada 1 → parada 2, …). */
  legs: RouteLeg[];
  /** Tempo total conferido pela rota real. */
  seconds: number;
  meters: number;
  /** Nome do provedor, mostrado ao clicar na linha. */
  source: string;
}

export interface GeometryService {
  /**
   * Devolve null quando não há provedor ou quando ele falha (o mapa fica só com
   * as retas), e "no-route" quando o provedor afirma que não existe caminho de carro.
   */
  getRoute(points: readonly Point[], departAt: Date): Promise<RouteGeometry | null | "no-route">;
}

type FetchFn = typeof fetch;

/** O Calculate Route aceita no máximo 150 pontos intermediários. */
const MAX_POINTS = 150;

async function getJson(fetchFn: FetchFn, url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetchFn(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function total(legs: RouteLeg[], source: string): RouteGeometry {
  return {
    legs,
    seconds: legs.reduce((sum, leg) => sum + leg.seconds, 0),
    meters: legs.reduce((sum, leg) => sum + leg.meters, 0),
    source,
  };
}

interface CalculateRouteResponse {
  routes?: {
    legs?: {
      summary?: { travelTimeInSeconds?: number; lengthInMeters?: number };
      points?: { latitude: number; longitude: number }[];
    }[];
  }[];
}

export function createTomTomGeometry(
  apiKey: string,
  cache: Cache,
  fetchFn: FetchFn = fetch,
  now: () => number = Date.now,
): GeometryService {
  const breaker = new CircuitBreaker("tomtom-rota", 3, 60_000, now);

  return {
    async getRoute(points, departAt) {
      if (points.length < 2 || points.length > MAX_POINTS) return null;

      const path = points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(":");
      const live = isNearNow(departAt, now());
      const key = `rt:v2:${live ? `live:${timeSlot(departAt)}` : `${departAt.getUTCDay()}:${timeSlot(departAt) % 96}`}:${path}`;
      const cached = await cache.get<RouteGeometry>(key);
      if (cached) return cached;

      const params = new URLSearchParams({
        key: apiKey,
        traffic: "true",
        travelMode: "car",
        routeType: "fastest",
        routeRepresentation: "polyline",
        // Sem balsas: carro não atravessa o mar. Pontes e túneis continuam valendo.
        avoid: "ferries",
      });
      // Sem departAt o padrão é "now"; datas precisam estar no futuro.
      if (departAt.getTime() - now() >= 60_000) params.set("departAt", departAt.toISOString());

      try {
        const data = (await withPolicy(breaker, (signal) =>
          getJson(fetchFn, `https://api.tomtom.com/routing/1/calculateRoute/${path}/json?${params}`, signal),
        )) as CalculateRouteResponse;

        const legs: RouteLeg[] = (data.routes?.[0]?.legs ?? []).map((leg) => ({
          coordinates: (leg.points ?? []).map((p) => [p.longitude, p.latitude] as [number, number]),
          seconds: leg.summary?.travelTimeInSeconds ?? NaN,
          meters: leg.summary?.lengthInMeters ?? NaN,
        }));
        const valid =
          legs.length === points.length - 1 &&
          legs.every((leg) => leg.coordinates.length >= 2 && Number.isFinite(leg.seconds) && Number.isFinite(leg.meters));
        if (!valid) return null;

        const geometry = total(legs, "TomTom");
        await cache.set(key, geometry, live ? 15 * 60 : 7 * 24 * 3600);
        return geometry;
      } catch (err) {
        console.warn("Geometria da rota (TomTom) indisponível.", err);
        return null;
      }
    },
  };
}

interface OsrmResponse {
  code?: string;
  routes?: {
    geometry?: { coordinates?: [number, number][] };
    legs?: { duration?: number; distance?: number }[];
  }[];
  waypoints?: { location?: [number, number]; distance?: number }[];
}

/** Corta a linha inteira nos pontos mais próximos de cada parada, em sequência. */
export function splitLine(
  line: [number, number][],
  waypoints: [number, number][],
): [number, number][][] {
  const cuts: number[] = [0];
  let from = 0;
  for (let w = 1; w < waypoints.length - 1; w++) {
    let best = from;
    let bestDistance = Infinity;
    for (let i = from; i < line.length; i++) {
      const d = haversineMeters(
        { lat: line[i][1], lng: line[i][0] },
        { lat: waypoints[w][1], lng: waypoints[w][0] },
      );
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    cuts.push(best);
    from = best;
  }
  cuts.push(line.length - 1);
  return cuts.slice(1).map((end, i) => line.slice(cuts[i], end + 1));
}

/** Distância máxima aceitável entre o ponto pedido e a estrada mais próxima. */
const MAX_SNAP_METERS = 5000;

/** OSRM demo (router.project-osrm.org). Sem trânsito. Uso restrito a desenvolvimento. */
export function createOsrmDemoGeometry(cache: Cache, fetchFn: FetchFn = fetch): GeometryService {
  const breaker = new CircuitBreaker("osrm-demo");

  return {
    async getRoute(points) {
      if (points.length < 2 || points.length > 25) return null;
      const path = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
      const key = `rt:v2:osrm:${path}`;
      const cached = await cache.get<RouteGeometry>(key);
      if (cached) return cached;

      try {
        // O servidor demo não aceita exclude=ferry, então aqui as balsas ainda entram.
        // Ele responde code "NoRoute" quando não há caminho.
        const data = (await withPolicy(breaker, async (signal) => {
          const res = await fetchFn(
            `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`,
            { signal, cache: "no-store" },
          );
          const body = (await res.json().catch(() => null)) as OsrmResponse | null;
          if (body?.code === "NoRoute") return body;
          if (!res.ok || !body) throw new Error(`HTTP ${res.status}`);
          return body;
        })) as OsrmResponse;
        if (data.code === "NoRoute") return "no-route";
        // Ponto sem estrada por perto (ex.: no meio do mar, ou fora da área coberta):
        // o OSRM "encaixa" o ponto na estrada mais próxima, mesmo a milhares de km.
        if (data.waypoints?.some((w) => (w.distance ?? 0) > MAX_SNAP_METERS)) return "no-route";

        const route = data.routes?.[0];
        const line = route?.geometry?.coordinates ?? [];
        const summaries = route?.legs ?? [];
        if (data.code !== "Ok" || line.length < 2 || summaries.length !== points.length - 1) return null;

        const snapped = points.map(
          (p, i) => data.waypoints?.[i]?.location ?? ([p.lng, p.lat] as [number, number]),
        );
        const pieces = splitLine(line, snapped);
        const legs: RouteLeg[] = summaries.map((leg, i) => ({
          coordinates: pieces[i].length >= 2 ? pieces[i] : [snapped[i], snapped[i + 1]],
          seconds: Math.round(leg.duration ?? 0),
          meters: Math.round(leg.distance ?? 0),
        }));

        const geometry = total(legs, "OSRM (demonstração, sem trânsito)");
        await cache.set(key, geometry, 24 * 3600);
        return geometry;
      } catch (err) {
        console.warn("Geometria da rota (OSRM demo) indisponível.", err);
        return null;
      }
    },
  };
}

/** Tenta cada serviço em ordem e fica com o primeiro que responder. */
export function chainGeometry(services: GeometryService[]): GeometryService {
  return {
    async getRoute(points, departAt) {
      for (const service of services) {
        const route = await service.getRoute(points, departAt);
        if (route) return route;
      }
      return null;
    },
  };
}

export const noGeometry: GeometryService = { getRoute: async () => null };
