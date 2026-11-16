/** Cliente das rotas de IA. Toda falha vira "local": a IA nunca bloqueia a interface. */
import type { AiTier, RouteReview } from "./server/ai";

export interface ReviewOutcome {
  tier: AiTier;
  provider: string | null;
  review: RouteReview | null;
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
export function reviewRequestBody(labels: string[], legSeconds: number[], roundTrip: boolean, lockedCount: number) {
  return {
    labels: labels.map((label) => label.slice(0, 120)),
    legMinutes: legSeconds.map((seconds) => Math.round(seconds / 60)),
    roundTrip,
    lockedCount,
  };
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
