/**
 * Sugestões de endereço enquanto a pessoa digita (autocompletar).
 *
 * Usa a busca da TomTom com typeahead=true. O Nominatim não entra aqui: a
 * política de uso dele proíbe autocompletar. Cada pedido gasta cota da
 * TomTom, então o navegador espera a pessoa parar de digitar, só pede a partir
 * de 3 letras, e o resultado fica um dia em cache.
 */
import { isValidLatLng, type LatLng } from "../coordinates";
import type { Cache } from "./cache";
import { CircuitBreaker, withPolicy } from "./resilience";

export interface Suggestion extends LatLng {
  /** Linha principal: nome do lugar ou rua. */
  label: string;
  /** Linha de apoio: bairro/freguesia, código postal e cidade. */
  detail: string;
}

export interface SuggestService {
  suggest(query: string, near: LatLng | null): Promise<Suggestion[]>;
}

interface TomTomSearchResult {
  type?: string;
  poi?: { name?: string };
  address?: {
    freeformAddress?: string;
    municipalitySubdivision?: string;
    municipality?: string;
  };
  position?: { lat?: number; lon?: number };
}

const SUGGEST_TTL_S = 24 * 3600;

/** Converte um resultado da TomTom em duas linhas legíveis. */
export function toSuggestion(result: TomTomSearchResult): Suggestion | null {
  const point = { lat: Number(result.position?.lat), lng: Number(result.position?.lon) };
  if (!isValidLatLng(point)) return null;
  const address = result.address ?? {};
  const free = address.freeformAddress?.trim() ?? "";
  const [first, ...rest] = free.split(",").map((part) => part.trim()).filter(Boolean);
  const label = result.poi?.name?.trim() || first || address.municipality || "";
  if (!label) return null;
  const pieces = result.poi?.name ? [free] : rest;
  const zone = address.municipalitySubdivision?.trim();
  const detail = [zone && !pieces.join(" ").includes(zone) ? zone : null, ...pieces].filter(Boolean).join(", ");
  return { ...point, label, detail };
}

export function createTomTomSuggest(
  apiKey: string,
  cache: Cache,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): SuggestService {
  const breaker = new CircuitBreaker("tomtom-sugestoes", 3, 60_000, now);

  return {
    async suggest(rawQuery, near) {
      const query = rawQuery.normalize("NFC").replace(/\s+/g, " ").trim();
      if (query.length < 3) return [];
      const area = near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : "-";
      const key = `sug:v1:${query.toLowerCase()}|${area}`;
      const cached = await cache.get<Suggestion[]>(key);
      if (cached) return cached;

      const params = new URLSearchParams({ key: apiKey, typeahead: "true", limit: "6", language: "pt-BR" });
      if (near) {
        // lat/lon sem radius só dão preferência à região visível do mapa.
        params.set("lat", String(near.lat));
        params.set("lon", String(near.lng));
      }
      try {
        const data = (await withPolicy(
          breaker,
          async (signal) => {
            const res = await fetchFn(
              `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?${params}`,
              { signal, cache: "no-store" },
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          },
          // Sugestão velha não serve: sem nova tentativa e com tempo curto.
          { timeoutMs: 4000, retries: 0 },
        )) as { results?: TomTomSearchResult[] };

        const seen = new Set<string>();
        const list: Suggestion[] = [];
        for (const result of data.results ?? []) {
          const suggestion = toSuggestion(result);
          if (!suggestion) continue;
          const id = `${suggestion.label}|${suggestion.detail}`.toLowerCase();
          if (seen.has(id)) continue;
          seen.add(id);
          list.push(suggestion);
        }
        await cache.set(key, list, SUGGEST_TTL_S);
        return list;
      } catch (err) {
        console.warn("Sugestões de endereço (TomTom) indisponíveis.", err instanceof Error ? err.message : err);
        return [];
      }
    },
  };
}

export const noSuggest: SuggestService = { suggest: async () => [] };
