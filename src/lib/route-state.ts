/** Estado da rota guardado no navegador (localStorage). */
import { MAX_STOPS } from "./stops";
import type { Place, TimeMode } from "./types";

export interface RouteState {
  /** Ponto de partida; null enquanto a pessoa não definiu. */
  start: Place | null;
  endSame: boolean;
  end: Place | null;
  /** Paradas na ordem em que foram digitadas. A ordem exibida vem do solver. */
  stops: Place[];
  /** Locais travados: id → posição na visita (0 = primeira parada). */
  locks?: Record<string, number>;
  /** Paradas já concluídas (ids): riscadas na lista e com o trecho cinza no mapa. */
  done?: string[];
  timeMode: TimeMode;
}

export const ROUTE_KEY = "rotas:rota:v2";

/** Primeira visita: tudo vazio. Só o que a pessoa preencher é guardado. */
export const EMPTY_ROUTE: RouteState = {
  start: null,
  endSame: true,
  end: null,
  stops: [],
  timeMode: "depart",
};

export const isPlace = (value: unknown): value is Place => {
  const p = value as Partial<Place> | null;
  return (
    !!p &&
    typeof p.id === "string" &&
    typeof p.label === "string" &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
};

export function isRouteState(value: unknown): value is RouteState {
  const r = value as Partial<RouteState> | null;
  return (
    !!r &&
    (r.start === null || isPlace(r.start)) &&
    typeof r.endSame === "boolean" &&
    (r.end === null || isPlace(r.end)) &&
    Array.isArray(r.stops) &&
    r.stops.length <= MAX_STOPS &&
    r.stops.every(isPlace) &&
    (r.timeMode === "depart" || r.timeMode === "arrive")
  );
}

/**
 * Ids da antiga rota de exemplo (Barreiro, Belém, Parque das Nações, Costa da
 * Caparica). Locais de verdade têm UUID, então não há como confundir.
 */
const EXAMPLE_IDS = new Set(["B", "Be", "PN", "CC", "PC", "Bf"]);

/**
 * true quando o que está guardado é só a rota de exemplo das primeiras versões,
 * sem nada que a pessoa tenha posto. Nesse caso o app começa vazio.
 */
export function isUntouchedExample(route: RouteState): boolean {
  const places = [route.start, ...route.stops, ...(route.end ? [route.end] : [])].filter(
    (p): p is Place => p !== null,
  );
  return places.length > 0 && places.every((p) => EXAMPLE_IDS.has(p.id));
}

/** O que vale de fato: o guardado ou, se for só o exemplo antigo, a rota vazia. */
export function normalizeRoute(stored: RouteState): RouteState {
  return isUntouchedExample(stored) ? EMPTY_ROUTE : stored;
}

/** Início e fim, que também contam como "já está na rota" para duplicados. */
export function fixedPlacesOf(route: RouteState): Place[] {
  return [route.start, !route.endSame ? route.end : null].filter((p): p is Place => p !== null);
}
