/**
 * Leitura de um local digitado: coordenadas, link de mapa ou endereço.
 * Só chama o servidor quando o texto não se resolve sozinho.
 */
import { parseCoordinates, type LatLng } from "./coordinates";
import { formatLatLng } from "./format";
import { extractUrlFromText, isMapUrl, parseInput, toUrl } from "./map-urls";
import type { PlaceSource } from "./types";

export interface PlaceDraft extends LatLng {
  label: string;
  source: PlaceSource;
  confidence: number;
}

/** Área visível do mapa: [oeste, sul, leste, norte]. */
export type BBoxTuple = [number, number, number, number];

export type InputKind =
  | { kind: "coords"; point: LatLng; source: "coords" | "link" }
  | { kind: "link"; text: string }
  | { kind: "address"; query: string };

/** Decide, sem rede, como o texto deve ser tratado. */
export function classifyInput(text: string): InputKind {
  const trimmed = text.trim();
  const coords = parseCoordinates(trimmed);
  if (coords) return { kind: "coords", point: coords, source: "coords" };
  // Link (ou texto com link) que já traz as coordenadas.
  const fromLink = parseInput(trimmed);
  if (fromLink) return { kind: "coords", point: fromLink, source: "link" };
  // Link sem coordenadas (curto ou de lugar por nome): só o servidor resolve.
  const url = toUrl(trimmed);
  if ((url && isMapUrl(url)) || extractUrlFromText(trimmed)) return { kind: "link", text: trimmed };
  return { kind: "address", query: trimmed };
}

type FetchFn = typeof fetch;

async function getJson<T>(fetchFn: FetchFn, url: string): Promise<T | null> {
  try {
    const res = await fetchFn(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Devolve o local lido ou null quando nada foi encontrado. */
export async function resolvePlaceInput(
  text: string,
  bbox: BBoxTuple | null,
  fetchFn: FetchFn = fetch,
): Promise<PlaceDraft | null> {
  const input = classifyInput(text);

  if (input.kind === "coords") {
    const { lat, lng } = input.point;
    return { lat, lng, label: formatLatLng(lat, lng), source: input.source, confidence: 1 };
  }

  if (input.kind === "link") {
    const found = await getJson<LatLng & { label?: string }>(
      fetchFn,
      `/api/resolve?u=${encodeURIComponent(input.text)}`,
    );
    if (!found) return null;
    return {
      lat: found.lat,
      lng: found.lng,
      label: found.label || formatLatLng(found.lat, found.lng),
      source: "link",
      confidence: 0.9,
    };
  }

  const params = new URLSearchParams({ q: input.query });
  if (bbox) params.set("bbox", bbox.map((n) => n.toFixed(4)).join(","));
  const found = await getJson<LatLng & { label: string; confidence: number }>(
    fetchFn,
    `/api/geocode?${params}`,
  );
  if (!found) return null;
  return {
    lat: found.lat,
    lng: found.lng,
    label: found.label,
    source: "address",
    confidence: found.confidence,
  };
}

/** Sugestão do autocompletar (vem de /api/suggest). */
export interface AddressSuggestion extends LatLng {
  label: string;
  detail: string;
}

/**
 * Sugestões de endereço para o texto digitado. Só pede quando o texto parece
 * um endereço (não coordenadas nem link) e tem pelo menos 3 letras.
 */
export async function fetchSuggestions(
  text: string,
  near: LatLng | null,
  signal?: AbortSignal,
  fetchFn: FetchFn = fetch,
): Promise<AddressSuggestion[]> {
  const query = text.trim();
  if (query.length < 3 || classifyInput(query).kind !== "address") return [];
  const params = new URLSearchParams({ q: query.slice(0, 120) });
  if (near) params.set("near", `${near.lat.toFixed(3)},${near.lng.toFixed(3)}`);
  try {
    const res = await fetchFn(`/api/suggest?${params}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: AddressSuggestion[] };
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch {
    return [];
  }
}

/** Nome da zona (bairro ou freguesia, e a cidade) de um ponto, ou null. */
export async function areaLabel(point: LatLng, fetchFn: FetchFn = fetch): Promise<string | null> {
  const found = await getJson<{ label: string | null }>(
    fetchFn,
    `/api/reverse?kind=area&lat=${point.lat.toFixed(6)}&lng=${point.lng.toFixed(6)}`,
  );
  return found?.label ?? null;
}

/** true quando o rótulo é só a coordenada (local digitado como coordenadas ou link). */
export function isCoordinateLabel(place: LatLng & { label: string }): boolean {
  return place.label === formatLatLng(place.lat, place.lng) || parseCoordinates(place.label) !== null;
}

/** Endereço de um ponto do mapa, ou null. */
export async function reverseLabel(point: LatLng, fetchFn: FetchFn = fetch): Promise<string | null> {
  const found = await getJson<{ label: string | null }>(
    fetchFn,
    `/api/reverse?lat=${point.lat.toFixed(6)}&lng=${point.lng.toFixed(6)}`,
  );
  return found?.label ?? null;
}
