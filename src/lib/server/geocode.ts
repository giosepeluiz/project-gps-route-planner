/**
 * Geocodificação com fallback: Nominatim público (OSM) → TomTom Geocoding.
 *
 * Política do Nominatim (https://operations.osmfoundation.org/policies/nominatim/):
 * no máximo 1 requisição por segundo, User-Agent identificando o app, sem
 * autocomplete e com cache dos resultados. Por isso a busca só acontece no
 * Enter/botão, passa por uma fila global e fica 30 dias em cache.
 */
import { isValidLatLng, type LatLng } from "../coordinates";
import { expandAbbreviations, geocodeQueries } from "../geocode-queries";
import type { Cache } from "./cache";
import { CircuitBreaker, RateQueue, withPolicy } from "./resilience";

export interface GeocodeResult extends LatLng {
  label: string;
  /** De 0 a 1. */
  confidence: number;
  provider: string;
}

/** Área visível do mapa, usada como viés de localização. */
export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface GeocodeProvider {
  name: string;
  search(query: string, bbox: BBox | null, signal: AbortSignal): Promise<GeocodeResult | null>;
  reverse(point: LatLng, signal: AbortSignal): Promise<string | null>;
  /** Nome da zona (bairro ou freguesia, e a cidade) de um ponto. */
  area(point: LatLng, signal: AbortSignal): Promise<string | null>;
}

/** "Zona, Cidade", sem repetir quando os dois são iguais. */
export function zoneLabel(zone: string | null | undefined, city: string | null | undefined): string | null {
  const z = zone?.trim();
  const c = city?.trim();
  if (z && c && z.toLowerCase() !== c.toLowerCase()) return `${z}, ${c}`;
  return z || c || null;
}

interface NominatimAddress {
  suburb?: string;
  quarter?: string;
  neighbourhood?: string;
  hamlet?: string;
  village?: string;
  city_district?: string;
  town?: string;
  city?: string;
  municipality?: string;
}

/** Bairro (ou lugarejo, ou freguesia) e cidade, a partir do endereço do Nominatim. */
export function nominatimZone(address: NominatimAddress | undefined): string | null {
  if (!address) return null;
  const zone =
    address.suburb ?? address.quarter ?? address.neighbourhood ?? address.hamlet ?? address.village ?? address.city_district;
  const city = address.city ?? address.town ?? address.municipality;
  return zoneLabel(zone, city);
}

type FetchFn = typeof fetch;

const GEOCODE_TTL_S = 30 * 24 * 3600;
const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Texto uniforme para busca e para a chave de cache. */
export function normalizeQuery(query: string): string {
  return expandAbbreviations(query.normalize("NFC").replace(/\s+/g, " ").trim());
}

/** Rótulo curto: o nome do lugar ou os dois primeiros trechos do endereço. */
export function shortLabel(displayName: string, name?: string | null): string {
  const parts = displayName
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (name?.trim()) {
    const extra = parts.find((p) => p !== name.trim() && !/^\d+$/.test(p));
    return extra ? `${name.trim()}, ${extra}` : name.trim();
  }
  return parts.slice(0, 2).join(", ") || displayName.trim();
}

async function getJson(fetchFn: FetchFn, url: string, init: RequestInit): Promise<unknown> {
  const res = await fetchFn(url, { ...init, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface NominatimItem {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  importance?: number;
}

export function createNominatim(
  userAgent: string,
  fetchFn: FetchFn = fetch,
  queue: RateQueue = new RateQueue(1100),
): GeocodeProvider {
  const base = "https://nominatim.openstreetmap.org";
  const headers = { "User-Agent": userAgent, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5" };

  return {
    name: "nominatim",

    async search(query, bbox, signal) {
      const params = new URLSearchParams({ format: "jsonv2", limit: "1", q: query });
      // viewbox = lon1,lat1,lon2,lat2. Sem bounded=1 ele só dá preferência à área.
      if (bbox) params.set("viewbox", `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`);
      const data = await queue.run(() => getJson(fetchFn, `${base}/search?${params}`, { headers, signal }));
      const item = Array.isArray(data) ? (data[0] as NominatimItem | undefined) : undefined;
      if (!item) return null;
      const point = { lat: Number(item.lat), lng: Number(item.lon) };
      if (!isValidLatLng(point)) return null;
      return {
        ...point,
        label: shortLabel(item.display_name ?? query, item.name),
        confidence: clamp01(item.importance ?? 0.5),
        provider: "nominatim",
      };
    },

    async reverse(point, signal) {
      const params = new URLSearchParams({
        format: "jsonv2",
        lat: String(point.lat),
        lon: String(point.lng),
        zoom: "18",
      });
      const data = (await queue.run(() =>
        getJson(fetchFn, `${base}/reverse?${params}`, { headers, signal }),
      )) as NominatimItem & { error?: string };
      if (!data || data.error || !data.display_name) return null;
      return shortLabel(data.display_name, data.name);
    },

    async area(point, signal) {
      // zoom 14 = nível de bairro; o reverse já traz os detalhes do endereço.
      const params = new URLSearchParams({
        format: "jsonv2",
        lat: String(point.lat),
        lon: String(point.lng),
        zoom: "14",
        addressdetails: "1",
      });
      const data = (await queue.run(() =>
        getJson(fetchFn, `${base}/reverse?${params}`, { headers, signal }),
      )) as { address?: NominatimAddress; error?: string };
      if (!data || data.error) return null;
      return nominatimZone(data.address);
    },
  };
}

interface TomTomSearch {
  results?: {
    position?: { lat?: number; lon?: number };
    address?: { freeformAddress?: string };
    matchConfidence?: { score?: number };
  }[];
}

interface TomTomReverse {
  addresses?: {
    address?: { freeformAddress?: string; municipalitySubdivision?: string; municipality?: string };
  }[];
}

export function createTomTom(apiKey: string, fetchFn: FetchFn = fetch): GeocodeProvider {
  const base = "https://api.tomtom.com/search/2";

  return {
    name: "tomtom",

    async search(query, bbox, signal) {
      const params = new URLSearchParams({ key: apiKey, limit: "1", language: "pt-BR" });
      if (bbox) {
        // lat/lon sem radius apenas dão preferência à região.
        params.set("lat", String((bbox.north + bbox.south) / 2));
        params.set("lon", String((bbox.east + bbox.west) / 2));
      }
      const data = (await getJson(
        fetchFn,
        `${base}/geocode/${encodeURIComponent(query)}.json?${params}`,
        { signal },
      )) as TomTomSearch;
      const first = data.results?.[0];
      const point = { lat: Number(first?.position?.lat), lng: Number(first?.position?.lon) };
      if (!first || !isValidLatLng(point)) return null;
      return {
        ...point,
        label: shortLabel(first.address?.freeformAddress ?? query),
        confidence: clamp01(first.matchConfidence?.score ?? 0.5),
        provider: "tomtom",
      };
    },

    async reverse(point, signal) {
      const params = new URLSearchParams({ key: apiKey, language: "pt-BR", radius: "100" });
      const data = (await getJson(
        fetchFn,
        `${base}/reverseGeocode/${point.lat},${point.lng}.json?${params}`,
        { signal },
      )) as TomTomReverse;
      const address = data.addresses?.[0]?.address?.freeformAddress;
      return address ? shortLabel(address) : null;
    },

    async area(point, signal) {
      const params = new URLSearchParams({ key: apiKey, language: "pt-BR", radius: "200" });
      const data = (await getJson(
        fetchFn,
        `${base}/reverseGeocode/${point.lat},${point.lng}.json?${params}`,
        { signal },
      )) as TomTomReverse;
      const address = data.addresses?.[0]?.address;
      // municipalitySubdivision é a freguesia (Portugal) ou o bairro (Brasil).
      return zoneLabel(address?.municipalitySubdivision, address?.municipality);
    },
  };
}

export interface Geocoder {
  search(query: string, bbox?: BBox | null): Promise<GeocodeResult | null>;
  reverse(point: LatLng): Promise<{ label: string; provider: string } | null>;
  /** Nome da zona (bairro/freguesia, cidade) de um ponto. */
  area(point: LatLng): Promise<{ label: string; provider: string } | null>;
}

export interface GeocoderOptions {
  providers: GeocodeProvider[];
  cache: Cache;
  timeoutMs?: number;
  retries?: number;
  /** Quantas variações do endereço tentar por provedor (do completo até só a rua). */
  maxVariants?: number;
}

/**
 * Cadeia de geocodificação. Um provedor que falha (erro, timeout, circuito
 * aberto) ou que não encontra nada passa a vez para o próximo.
 */
export function createGeocoder({
  providers,
  cache,
  timeoutMs = 8000,
  retries = 1,
  maxVariants = 3,
}: GeocoderOptions): Geocoder {
  const breakers = new Map(providers.map((p) => [p.name, new CircuitBreaker(p.name)]));
  const policy = { timeoutMs, retries };

  return {
    async search(rawQuery, bbox = null) {
      const query = normalizeQuery(rawQuery);
      if (!query) return null;
      // O viés muda o resultado, então entra (arredondado) na chave.
      const area = bbox
        ? `${Math.round((bbox.north + bbox.south) / 2)},${Math.round((bbox.east + bbox.west) / 2)}`
        : "-";
      const key = `geo:v1:${query.toLowerCase()}|${area}`;
      const cached = await cache.get<GeocodeResult>(key);
      if (cached) return cached;

      const variants = geocodeQueries(query, maxVariants);
      for (const provider of providers) {
        const breaker = breakers.get(provider.name)!;
        try {
          for (const variant of variants) {
            const found = await withPolicy(breaker, (signal) => provider.search(variant, bbox, signal), policy);
            if (found) {
              await cache.set(key, found, GEOCODE_TTL_S);
              return found;
            }
          }
        } catch (err) {
          console.warn(`Geocodificação: ${provider.name} falhou, tentando o próximo.`, err);
        }
      }
      return null;
    },

    reverse: (point) => reverseLike("rev:v1", point, (provider, signal) => provider.reverse(point, signal)),
    area: (point) => reverseLike("area:v1", point, (provider, signal) => provider.area(point, signal)),
  };

  async function reverseLike(
    prefix: string,
    point: LatLng,
    ask: (provider: GeocodeProvider, signal: AbortSignal) => Promise<string | null>,
  ): Promise<{ label: string; provider: string } | null> {
    const key = `${prefix}:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    const cached = await cache.get<{ label: string; provider: string }>(key);
    if (cached) return cached;

    for (const provider of providers) {
      const breaker = breakers.get(provider.name)!;
      try {
        const label = await withPolicy(breaker, (signal) => ask(provider, signal), policy);
        if (label) {
          const value = { label, provider: provider.name };
          await cache.set(key, value, GEOCODE_TTL_S);
          return value;
        }
      } catch (err) {
        console.warn(`Geocodificação reversa (${prefix}): ${provider.name} falhou, tentando o próximo.`, err);
      }
    }
    return null;
  }
}
