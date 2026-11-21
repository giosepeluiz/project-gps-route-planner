/** Cliente de POST /api/plan. Envia o mínimo: ids e coordenadas, sem rótulos. */
import { apiUrl } from "@/lib/api-base";
import { dwellSecondsOf } from "./plan";
import type { PlanResponse } from "./server/plan";
import type { Place, TimeMode } from "./types";

interface RouteInput {
  start: Place;
  /** Paradas na ordem digitada. */
  stops: readonly Place[];
  end: Place | null;
  endSame: boolean;
  /** Locais travados: id → posição na visita. */
  locks: Record<string, number>;
  mode: TimeMode;
  /** Valor do campo datetime-local, ou null para "agora". */
  dateTime: string | null;
  /** Direção do carro no início (viagem), em graus. */
  heading?: number | null;
}

const point = (p: Place) => ({ id: p.id, lat: p.lat, lng: p.lng });

/** Parada: além do ponto, a permanência (só quando há), que muda o horário de saída no "Chegar até". */
const stopPoint = (p: Place) => {
  const dwellMin = dwellSecondsOf(p) / 60;
  return dwellMin > 0 ? { ...point(p), dwellMin } : point(p);
};

export function planRequestBody({ start, stops, end, endSame, locks, mode, dateTime, heading }: RouteInput) {
  const at = dateTime ? new Date(dateTime) : null;
  return {
    start: point(start),
    stops: stops.map(stopPoint),
    end: !endSame && end ? point(end) : null,
    roundTrip: endSame,
    locks,
    mode,
    at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
    ...(heading == null ? {} : { heading: Math.round(((heading % 360) + 360) % 360) % 360 }),
  };
}

export type PlanOutcome =
  | { kind: "ok"; plan: PlanResponse }
  /** Não existe caminho de carro (ex.: locais separados pelo mar). */
  | { kind: "no-route"; fromId: string | null; toId: string | null }
  | { kind: "failed" };

export async function fetchPlan(
  body: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<PlanOutcome> {
  try {
    const res = await fetchFn(apiUrl("/api/plan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
    if (res.ok) return { kind: "ok", plan: (await res.json()) as PlanResponse };
    if (res.status === 422) {
      const data = (await res.json()) as { error?: string; fromId?: string | null; toId?: string | null };
      if (data.error === "no_route") {
        return { kind: "no-route", fromId: data.fromId ?? null, toId: data.toId ?? null };
      }
    }
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
