/**
 * Geometria da rota final: uma chamada ao TomTom Calculate Route com os pontos
 * já ordenados, para desenhar no mapa e conferir o tempo total.
 * GET https://api.tomtom.com/routing/1/calculateRoute/{lat,lon:lat,lon…}/json
 */
import { timeSlot } from "../solver";
import type { Cache } from "./cache";
import { isNearNow, type Point } from "./matrix";
import { CircuitBreaker, withPolicy } from "./resilience";

export interface RouteGeometry {
  /** Linha da rota em [lng, lat]. */
  coordinates: [number, number][];
  /** Tempo total conferido pela rota real. */
  seconds: number;
  meters: number;
}

export interface GeometryService {
  /** Devolve null quando não há provedor ou quando ele falha (o mapa usa retas tracejadas). */
  getRoute(points: readonly Point[], departAt: Date): Promise<RouteGeometry | null>;
}

type FetchFn = typeof fetch;

interface CalculateRouteResponse {
  routes?: {
    summary?: { travelTimeInSeconds?: number; lengthInMeters?: number };
    legs?: { points?: { latitude: number; longitude: number }[] }[];
  }[];
}

/** O Calculate Route aceita no máximo 150 pontos intermediários. */
const MAX_POINTS = 150;

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
      const key = `rt:v1:${live ? `live:${timeSlot(departAt)}` : `${departAt.getUTCDay()}:${timeSlot(departAt) % 96}`}:${path}`;
      const cached = await cache.get<RouteGeometry>(key);
      if (cached) return cached;

      const params = new URLSearchParams({
        key: apiKey,
        traffic: "true",
        travelMode: "car",
        routeType: "fastest",
        routeRepresentation: "polyline",
      });
      // Sem departAt o padrão é "now"; datas precisam estar no futuro.
      if (departAt.getTime() - now() >= 60_000) params.set("departAt", departAt.toISOString());

      try {
        const data = await withPolicy(breaker, async (signal) => {
          const res = await fetchFn(
            `https://api.tomtom.com/routing/1/calculateRoute/${path}/json?${params}`,
            { signal, cache: "no-store" },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as CalculateRouteResponse;
        });

        const route = data.routes?.[0];
        const coordinates: [number, number][] = [];
        for (const leg of route?.legs ?? []) {
          for (const p of leg.points ?? []) coordinates.push([p.longitude, p.latitude]);
        }
        const seconds = route?.summary?.travelTimeInSeconds;
        if (coordinates.length < 2 || typeof seconds !== "number") return null;

        const geometry = { coordinates, seconds, meters: route?.summary?.lengthInMeters ?? 0 };
        await cache.set(key, geometry, live ? 15 * 60 : 7 * 24 * 3600);
        return geometry;
      } catch (err) {
        console.warn("Geometria da rota indisponível; o mapa usa o traçado aproximado.", err);
        return null;
      }
    },
  };
}

export const noGeometry: GeometryService = { getRoute: async () => null };
