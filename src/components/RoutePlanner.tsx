"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import CollapsibleCard, { Chevron } from "./CollapsibleCard";
import MapView, { type MapLayout, type MapPoint } from "./MapView";
import PlaceField, { inputClass } from "./PlaceField";
import {
  formatDuration,
  formatLatLng,
  formatTime,
  formatTimeWithDay,
  pluralStops,
  toLocalInputValue,
} from "@/lib/format";
import { useCurrentMinute, useLocalStorageState, useMediaQuery } from "@/lib/hooks";
import { MOCK_ORDERED_STOPS, MOCK_START, MOCK_TYPED_STOPS, mockLegTime } from "@/lib/mock-data";
import { resolvePlaceInput, reverseLabel, type BBoxTuple, type PlaceDraft } from "@/lib/place-input";
import { computePlan, sequenceSeconds } from "@/lib/plan";
import {
  addStop,
  isApproximate,
  isDuplicate,
  MAX_STOPS,
  MSG_APPROX,
  MSG_DUPLICATE,
  MSG_NOT_FOUND,
} from "@/lib/stops";
import type { Place, TimeMode } from "@/lib/types";

type BlockId = "inicio" | "paradas" | "resumo";
const BLOCKS_KEY = "rotas:blocos";
const BLOCKS_DEFAULT: Record<BlockId, boolean> = { inicio: true, paradas: true, resumo: true };

/** Último estado da rota, salvo em localStorage. */
interface RouteState {
  start: Place;
  endSame: boolean;
  end: Place | null;
  /** Paradas na ordem exibida (a ordem otimizada, quando o solver existir). */
  stops: Place[];
  /** Ids na ordem em que foram digitadas, para a comparação. */
  typedIds: string[];
  timeMode: TimeMode;
}

const ROUTE_KEY = "rotas:rota:v1";
const ROUTE_DEFAULT: RouteState = {
  start: MOCK_START,
  endSame: true,
  end: null,
  stops: MOCK_ORDERED_STOPS,
  typedIds: MOCK_TYPED_STOPS.map((s) => s.id),
  timeMode: "depart",
};

const isPlace = (value: unknown): value is Place => {
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

function isRouteState(value: unknown): boolean {
  const r = value as Partial<RouteState> | null;
  return (
    !!r &&
    isPlace(r.start) &&
    typeof r.endSame === "boolean" &&
    (r.end === null || isPlace(r.end)) &&
    Array.isArray(r.stops) &&
    r.stops.length <= MAX_STOPS &&
    r.stops.every(isPlace) &&
    Array.isArray(r.typedIds) &&
    r.typedIds.every((id) => typeof id === "string") &&
    (r.timeMode === "depart" || r.timeMode === "arrive")
  );
}

interface Toast {
  id: number;
  text: string;
  /** Parada que o botão "Desfazer" remove. */
  undoStopId?: string;
}

/** Balão aberto no mapa: um ponto livre ou um local da rota (`placeId`). */
interface Info {
  lat: number;
  lng: number;
  placeId?: string;
  /** undefined = buscando; null = não encontrado. */
  address?: string | null;
}

const pinLabel = (lat: number, lng: number) => `Pin ${formatLatLng(lat, lng)}`;

function makePlace(draft: PlaceDraft): Place {
  return { ...draft, id: crypto.randomUUID(), dwellMinutes: 0 };
}

function fixedPlacesOf(route: RouteState): Place[] {
  return !route.endSame && route.end ? [route.start, route.end] : [route.start];
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">
      {children}
    </span>
  );
}

const popupButton =
  "focus-ring rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-100";

export default function RoutePlanner({ fallbackStyleUrl }: { fallbackStyleUrl: string | null }) {
  const [route, setRoute] = useLocalStorageState(ROUTE_KEY, ROUTE_DEFAULT, isRouteState);
  const { start, endSame, end, stops, typedIds, timeMode } = route;
  /** null = "agora" (acompanha o relógio). */
  const [dateTime, setDateTime] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  /** Área visível do mapa, usada como viés na busca por endereço. */
  const bboxRef = useRef<BBoxTuple | null>(null);

  const [blocks, setBlocks] = useLocalStorageState(BLOCKS_KEY, BLOCKS_DEFAULT);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const currentMinute = useCurrentMinute();
  const switchId = useId();
  const dateId = useId();

  const isOpen = (id: BlockId) => blocks[id] ?? true;
  const toggle = (id: BlockId) => setBlocks({ ...BLOCKS_DEFAULT, ...blocks, [id]: !isOpen(id) });

  // O aviso some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = (text: string, undoStopId?: string) =>
    setToast({ id: Date.now(), text, undoStopId });

  const finalPlace = endSame ? start : end;

  const anchor = useMemo(() => {
    if (dateTime) return new Date(dateTime);
    return currentMinute === null ? null : new Date(currentMinute * 60_000);
  }, [dateTime, currentMinute]);

  const plan = useMemo(() => {
    if (!anchor || Number.isNaN(anchor.getTime())) return null;
    const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
    return computePlan(sequence, timeMode, anchor, mockLegTime);
  }, [anchor, start, stops, finalPlace, timeMode]);

  const typedSeconds = useMemo(() => {
    const typed = typedIds
      .map((id) => stops.find((s) => s.id === id))
      .filter((s): s is Place => s !== undefined);
    const sequence = finalPlace ? [start, ...typed, finalPlace] : [start, ...typed];
    return sequenceSeconds(sequence, mockLegTime);
  }, [typedIds, stops, start, finalPlace]);

  /** Adiciona a parada sobre o estado mais recente. Devolve a mensagem de erro, se houver. */
  const tryAddStop = (place: Place): string | null => {
    let problem: string | null = null;
    setRoute((prev) => {
      const result = addStop(prev.stops, place, fixedPlacesOf(prev));
      if (!result.ok) {
        problem = result.message;
        return prev;
      }
      return { ...prev, stops: result.stops, typedIds: [...prev.typedIds, place.id] };
    });
    return problem;
  };

  const removeStop = (id: string) =>
    setRoute((prev) => ({
      ...prev,
      stops: prev.stops.filter((s) => s.id !== id),
      typedIds: prev.typedIds.filter((x) => x !== id),
    }));

  const setFixed = (which: "start" | "end", place: Place): string | null => {
    let problem: string | null = null;
    setRoute((prev) => {
      if (isDuplicate(place, prev.stops)) {
        problem = MSG_DUPLICATE;
        return prev;
      }
      return which === "start" ? { ...prev, start: place } : { ...prev, end: place, endSame: false };
    });
    return problem;
  };

  const submitStop = async (text: string): Promise<string | null> => {
    const draft = await resolvePlaceInput(text, bboxRef.current);
    return draft ? tryAddStop(makePlace(draft)) : MSG_NOT_FOUND;
  };

  const submitFixed = async (text: string, which: "start" | "end"): Promise<string | null> => {
    const draft = await resolvePlaceInput(text, bboxRef.current);
    return draft ? setFixed(which, makePlace(draft)) : MSG_NOT_FOUND;
  };

  /** Clique esquerdo: abre o balão e busca o endereço do ponto. */
  const openInfo = (lat: number, lng: number, placeId?: string) => {
    setInfo({ lat, lng, placeId });
    void reverseLabel({ lat, lng }).then((address) =>
      setInfo((current) =>
        current && current.lat === lat && current.lng === lng ? { ...current, address } : current,
      ),
    );
  };

  /** Clique direito (ou toque longo): adiciona o pin e depois troca o rótulo pelo endereço. */
  const handleContextMenu = (lat: number, lng: number) => {
    const place = makePlace({ lat, lng, label: pinLabel(lat, lng), source: "pin", confidence: 1 });
    const problem = tryAddStop(place);
    if (problem) {
      notify(problem);
      return;
    }
    setInfo(null);
    notify("Parada adicionada.", place.id);
    void reverseLabel({ lat, lng }).then((address) => {
      if (!address) return;
      setRoute((prev) => ({
        ...prev,
        stops: prev.stops.map((s) => (s.id === place.id ? { ...s, label: address } : s)),
      }));
    });
  };

  const handlePointClick = (id: string) => {
    const place = [start, ...stops, ...(end ? [end] : [])].find((p) => p.id === id);
    if (place) openInfo(place.lat, place.lng, place.id);
  };

  /** Local do balão como novo Place (usa o endereço, se já chegou). */
  const placeFromInfo = (current: Info): Place =>
    makePlace({
      lat: current.lat,
      lng: current.lng,
      label: current.address || pinLabel(current.lat, current.lng),
      source: "pin",
      confidence: 1,
    });

  const infoPlace = info?.placeId
    ? [start, ...stops, ...(end ? [end] : [])].find((p) => p.id === info.placeId)
    : undefined;
  const infoIsStop = !!infoPlace && stops.some((s) => s.id === infoPlace.id);

  // Pins e linha do mapa.
  const points = useMemo<MapPoint[]>(() => {
    const list: MapPoint[] = [
      { id: start.id, lat: start.lat, lng: start.lng, kind: "start", badge: "A", title: start.label },
      ...stops.map<MapPoint>((s, i) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        kind: "stop",
        badge: String(i + 1),
        title: s.label,
      })),
    ];
    if (!endSame && end) {
      list.push({ id: end.id, lat: end.lat, lng: end.lng, kind: "end", badge: "B", title: end.label });
    }
    return list;
  }, [start, stops, endSame, end]);

  const path = useMemo<[number, number][]>(() => {
    const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
    return sequence.map((p) => [p.lng, p.lat]);
  }, [start, stops, finalPlace]);

  const layout: MapLayout = isDesktop ? "desktop" : sheetOpen ? "sheet-open" : "sheet-closed";

  // Textos de resumo.
  const totalText = plan ? formatDuration(plan.totalSeconds) : "—";
  const arriveText = plan ? formatTimeWithDay(plan.arriveAt, plan.departAt) : "—";
  const handleSummary = `${totalText} · ${pluralStops(stops.length)} · chega ${arriveText}`;
  const startEndSummary = endSame
    ? `${start.label} · ida e volta`
    : end
      ? `${start.label} → ${end.label}`
      : `${start.label} · termina na última parada`;
  const savedMinutes = plan ? Math.round((typedSeconds - plan.totalSeconds) / 60) : 0;
  const dateValue = dateTime ?? (anchor ? toLocalInputValue(anchor) : "");

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <h1 className="sr-only">Planejador de rotas</h1>

      <MapView
        points={points}
        path={path}
        approximate
        layout={layout}
        fallbackStyleUrl={fallbackStyleUrl}
        onMapClick={(lat, lng) => openInfo(lat, lng)}
        onMapContextMenu={handleContextMenu}
        onPointClick={handlePointClick}
        onBoundsChange={(bbox) => {
          bboxRef.current = bbox;
        }}
        popupAt={info ? { lat: info.lat, lng: info.lng } : null}
        onPopupClose={() => setInfo(null)}
      >
        {info && (
          <div className="flex min-w-48 flex-col gap-2 pr-3 text-sm text-zinc-900">
            <div>
              <p className="font-semibold">
                {infoPlace ? infoPlace.label : (info.address ?? "Local selecionado")}
              </p>
              {infoPlace && (
                <p className="text-xs text-zinc-600">
                  {infoPlace.id === start.id
                    ? "Início da rota"
                    : infoIsStop
                      ? `Parada ${stops.findIndex((s) => s.id === infoPlace.id) + 1}`
                      : "Fim da rota"}
                </p>
              )}
              <p className="text-xs text-zinc-600" aria-live="polite">
                {info.address === undefined
                  ? "Buscando o endereço…"
                  : info.address === null
                    ? "Endereço não encontrado."
                    : infoPlace && info.address !== infoPlace.label
                      ? info.address
                      : null}
              </p>
              <p className="font-mono text-xs text-zinc-600">{formatLatLng(info.lat, info.lng)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {!infoPlace && (
                <>
                  <button
                    type="button"
                    className={`${popupButton} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`}
                    onClick={() => {
                      const place = placeFromInfo(info);
                      const problem = tryAddStop(place);
                      if (problem) notify(problem);
                      else {
                        notify("Parada adicionada.", place.id);
                        setInfo(null);
                      }
                    }}
                  >
                    Adicionar parada
                  </button>
                  <button
                    type="button"
                    className={popupButton}
                    onClick={() => {
                      const problem = setFixed("start", placeFromInfo(info));
                      if (problem) notify(problem);
                      else setInfo(null);
                    }}
                  >
                    Usar como início
                  </button>
                  <button
                    type="button"
                    className={popupButton}
                    onClick={() => {
                      const problem = setFixed("end", placeFromInfo(info));
                      if (problem) notify(problem);
                      else setInfo(null);
                    }}
                  >
                    Usar como fim
                  </button>
                </>
              )}
              {infoPlace && infoIsStop && (
                <button
                  type="button"
                  className={popupButton}
                  onClick={() => {
                    removeStop(infoPlace.id);
                    setInfo(null);
                  }}
                >
                  Remover parada
                </button>
              )}
            </div>
          </div>
        )}
      </MapView>

      <aside
        aria-label="Planejamento da rota"
        className="fixed inset-x-0 bottom-0 z-10 flex max-h-[60dvh] flex-col rounded-t-2xl bg-zinc-100/95 shadow-[0_-4px_24px_rgba(0,0,0,0.2)] backdrop-blur md:pointer-events-none md:absolute md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-80 md:rounded-none md:bg-transparent md:shadow-none md:backdrop-blur-none dark:bg-zinc-950/95 md:dark:bg-transparent"
      >
        <button
          type="button"
          aria-expanded={sheetOpen}
          aria-controls="hud-conteudo"
          onClick={() => setSheetOpen((open) => !open)}
          className="focus-ring flex w-full shrink-0 flex-col items-center gap-1.5 rounded-t-2xl px-4 pb-3 pt-2 md:hidden"
        >
          <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-zinc-400 dark:bg-zinc-500" />
          <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
            <span className="truncate">{handleSummary}</span>
            <span className="rotate-180 text-zinc-500 dark:text-zinc-400">
              <Chevron open={sheetOpen} />
            </span>
          </span>
          <span className="sr-only">{sheetOpen ? "Recolher painel" : "Abrir painel"}</span>
        </button>

        <div
          id="hud-conteudo"
          className={`${sheetOpen ? "flex" : "hidden"} min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-3 md:flex md:p-0 md:pr-1`}
        >
          <CollapsibleCard
            id="bloco-inicio"
            title="Início e fim"
            summary={startEndSummary}
            open={isOpen("inicio")}
            onToggle={() => toggle("inicio")}
          >
            <div className="flex flex-col gap-3">
              <PlaceField
                label="Início"
                value={start.label}
                placeholder="Endereço, coordenadas ou link"
                onSubmit={(text) => submitFixed(text, "start")}
              />

              <div className="flex items-center justify-between gap-3">
                <span id={switchId} className="text-sm">
                  O local de fim é o mesmo do início
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={endSame}
                  aria-labelledby={switchId}
                  onClick={() => setRoute((prev) => ({ ...prev, endSame: !prev.endSame }))}
                  className={`focus-ring relative h-6 w-11 shrink-0 rounded-full transition-colors motion-reduce:transition-none ${
                    endSame ? "bg-blue-600" : "bg-zinc-400 dark:bg-zinc-600"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
                      endSame ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>

              {/* O campo Fim só aparece com o switch desligado. */}
              {!endSame && (
                <PlaceField
                  label="Fim"
                  value={end?.label ?? ""}
                  placeholder="Opcional: endereço, coordenadas ou link"
                  onSubmit={(text) => submitFixed(text, "end")}
                />
              )}

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Horário
                </legend>
                <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-zinc-200 p-1 dark:bg-zinc-800">
                  {(
                    [
                      ["depart", "Sair em"],
                      ["arrive", "Chegar até"],
                    ] as const
                  ).map(([mode, text]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={timeMode === mode}
                      onClick={() => setRoute((prev) => ({ ...prev, timeMode: mode }))}
                      className={`focus-ring rounded-md px-2 py-1.5 text-sm font-medium ${
                        timeMode === mode
                          ? "bg-white text-zinc-900 shadow dark:bg-zinc-600 dark:text-white"
                          : "text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <label htmlFor={dateId} className="sr-only">
                    Data e hora
                  </label>
                  <input
                    id={dateId}
                    type="datetime-local"
                    className={inputClass}
                    value={dateValue}
                    onChange={(e) => setDateTime(e.target.value || null)}
                  />
                  <button
                    type="button"
                    onClick={() => setDateTime(null)}
                    disabled={dateTime === null}
                    className="focus-ring shrink-0 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-100 disabled:cursor-default disabled:text-zinc-500 disabled:hover:bg-transparent dark:border-zinc-600 dark:hover:bg-zinc-800 dark:disabled:text-zinc-400"
                  >
                    Agora
                  </button>
                </div>
              </fieldset>
            </div>
          </CollapsibleCard>

          <CollapsibleCard
            id="bloco-paradas"
            title={`Paradas (${stops.length}/${MAX_STOPS})`}
            summary={pluralStops(stops.length)}
            open={isOpen("paradas")}
            onToggle={() => toggle("paradas")}
          >
            <div className="flex flex-col gap-3">
              {stops.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Nenhuma parada ainda. Adicione abaixo ou clique no mapa.
                </p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {stops.map((stop, i) => {
                    const leg = plan?.legs[i];
                    return (
                      <li key={stop.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                        <span
                          aria-hidden="true"
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-semibold text-white"
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{stop.label}</span>
                          <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                            {leg
                              ? `${leg.estimated ? "≈ " : "+"}${formatDuration(leg.seconds)} · chega ${formatTime(leg.arriveAt)}`
                              : "—"}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeStop(stop.id)}
                          aria-label={`Remover ${stop.label}`}
                          className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-200 hover:text-red-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                        >
                          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M5 5l10 10M15 5L5 15" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}

              {isApproximate(stops.length) && (
                <p role="status" className="rounded-lg bg-amber-100 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {MSG_APPROX}
                </p>
              )}

              <PlaceField
                label="Adicionar parada"
                value=""
                placeholder="Endereço, coordenadas ou link"
                addMode
                onSubmit={submitStop}
              />
            </div>
          </CollapsibleCard>

          <CollapsibleCard
            id="bloco-resumo"
            title="Resumo"
            summary={`${totalText} · chega ${arriveText}`}
            open={isOpen("resumo")}
            onToggle={() => toggle("resumo")}
          >
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-2xl font-semibold leading-tight">{totalText}</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  {endSame ? "Tempo total, ida e volta" : "Tempo total"}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-xs text-zinc-600 dark:text-zinc-400">Saída</dt>
                  <dd className="font-medium">{plan ? formatTime(plan.departAt) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-600 dark:text-zinc-400">Chegada</dt>
                  <dd className="font-medium">{arriveText}</dd>
                </div>
              </dl>

              <p>
                Na ordem digitada: {formatDuration(typedSeconds)}.{" "}
                {savedMinutes > 0 ? (
                  <strong className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Economia de {savedMinutes} min.
                  </strong>
                ) : (
                  "Sem economia nesta ordem."
                )}
              </p>

              <ul className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                <li>
                  Tempos: dados fictícios (os provedores de trânsito chegam na fase 4)
                  {plan?.hasEstimates ? ", com estimativa por distância (≈) nos locais novos" : ""}.
                </li>
                <li>
                  Ordem: {isApproximate(stops.length) ? "aproximada" : "exata"} (demonstração; a
                  otimização chega na fase 3).
                </li>
              </ul>

              <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <Badge>Local</Badge>
                Algoritmo local (nenhuma IA respondeu)
              </p>
            </div>
          </CollapsibleCard>
        </div>
      </aside>

      {toast && (
        <div
          key={toast.id}
          role="status"
          className="fixed left-1/2 top-16 w-max z-20 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg md:absolute md:bottom-6 md:top-auto dark:bg-zinc-100 dark:text-zinc-900"
        >
          <span>{toast.text}</span>
          {toast.undoStopId && (
            <button
              type="button"
              onClick={() => {
                removeStop(toast.undoStopId!);
                setToast(null);
              }}
              className="focus-ring rounded font-semibold text-blue-300 underline underline-offset-2 dark:text-blue-700"
            >
              Desfazer
            </button>
          )}
        </div>
      )}
    </main>
  );
}
