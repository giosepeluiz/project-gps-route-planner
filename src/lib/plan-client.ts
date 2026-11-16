/** Cliente de POST /api/plan. Envia o mínimo: ids e coordenadas, sem rótulos. */
import type { PlanResponse } from "./server/plan";
import type { Place, TimeMode } from "./types";

interface RouteInput {
  start: Place;
  /** Paradas na ordem digitada. */
  stops: readonly Place[];
  end: Place | null;
  endSame: boolean;
  mode: TimeMode;
  /** Valor do campo datetime-local, ou null para "agora". */
  dateTime: string | null;
}

const point = (p: Place) => ({ id: p.id, lat: p.lat, lng: p.lng });

export function planRequestBody({ start, stops, end, endSame, mode, dateTime }: RouteInput) {
  const at = dateTime ? new Date(dateTime) : null;
  return {
    start: point(start),
    stops: stops.map(point),
    end: !endSame && end ? point(end) : null,
    roundTrip: endSame,
    mode,
    at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
  };
}

/** Devolve o plano do servidor, ou null se a consulta falhar. */
export async function fetchPlan(
  body: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<PlanResponse | null> {
  try {
    const res = await fetchFn("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
    return res.ok ? ((await res.json()) as PlanResponse) : null;
  } catch {
    return null;
  }
}
