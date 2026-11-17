/** Cliente das rotas de IA. Toda falha vira "local": a IA nunca bloqueia a interface. */
import type { AiTier, ReviewResult } from "./server/ai";

export interface ReviewOutcome {
  tier: AiTier;
  provider: string | null;
  review: ReviewResult | null;
}

export interface ParseOutcome {
  tier: AiTier;
  places: string[];
}

export const LOCAL_REVIEW: ReviewOutcome = { tier: "local", provider: null, review: null };

async function post<T>(url: string, body: unknown, signal: AbortSignal | undefined, fetchFn: typeof fetch): Promise<T | null> {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Corpo do pedido de revisão: só rótulos e minutos, na ordem da visita. */
export function reviewRequestBody(
  labels: string[],
  legSeconds: number[],
  roundTrip: boolean,
  lockedCount: number,
  stopCount?: number,
) {
  return {
    labels: labels.map((label) => label.slice(0, 120)),
    legMinutes: legSeconds.map((seconds) => Math.round(seconds / 60)),
    roundTrip,
    lockedCount,
    ...(stopCount === undefined ? {} : { stopCount }),
  };
}

/**
 * Travas que fixam cada parada na posição da ordem sugerida pela IA.
 * `stopIds` são as paradas na ordem em que foram revisadas.
 */
export function locksFromSuggestion(stopIds: readonly string[], suggestedStops: readonly number[]): Record<string, number> | null {
  if (suggestedStops.length !== stopIds.length) return null;
  const locks: Record<string, number> = {};
  suggestedStops.forEach((from, to) => {
    const id = stopIds[from];
    if (id !== undefined) locks[id] = to;
  });
  return Object.keys(locks).length === stopIds.length ? locks : null;
}

export async function fetchReview(
  body: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<ReviewOutcome> {
  const data = await post<ReviewOutcome>("/api/ai/review", JSON.parse(body), signal, fetchFn);
  return data && data.tier ? data : LOCAL_REVIEW;
}

export async function fetchParsedPlaces(text: string, fetchFn: typeof fetch = fetch): Promise<ParseOutcome> {
  const data = await post<ParseOutcome>("/api/ai/parse", { text }, undefined, fetchFn);
  return data && Array.isArray(data.places) ? data : { tier: "local", places: [] };
}

export const TIER_LABEL: Record<AiTier, string> = {
  primária: "Primária",
  backup: "Backup",
  local: "Local",
};
