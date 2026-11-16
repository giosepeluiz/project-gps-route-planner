"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import ActionsPanel from "./ActionsPanel";
import CollapsibleCard, { Chevron } from "./CollapsibleCard";
import MapView, { type MapLayout, type MapPoint } from "./MapView";
import PlaceField, { inputClass } from "./PlaceField";
import PlacePopup from "./PlacePopup";
import SettingsPanel from "./SettingsPanel";
import StopList from "./StopList";
import {
  formatDuration,
  formatKm,
  formatLatLng,
  formatTime,
  formatTimeWithDay,
  pluralStops,
  toLocalInputValue,
} from "@/lib/format";
import { useCurrentMinute, useLocalStorageState, useMediaQuery } from "@/lib/hooks";
import {
  fetchParsedPlaces,
  fetchReview,
  reviewRequestBody,
  TIER_LABEL,
  type ReviewOutcome,
} from "@/lib/ai-client";
import { legColor } from "@/lib/leg-colors";
import { cleanLocks, moveStop, removeFromLocks, toggleLock } from "@/lib/locks";
import { MOCK_START, MOCK_TYPED_STOPS } from "@/lib/mock-data";
import { optimizeStops } from "@/lib/optimize";
import { resolvePlaceInput, reverseLabel, type BBoxTuple, type PlaceDraft } from "@/lib/place-input";
import { computePlan, estimateLegTime } from "@/lib/plan";
import { fetchPlan, planRequestBody, type PlanOutcome } from "@/lib/plan-client";
import type { PlanResponse } from "@/lib/server/plan";
import {
  DEFAULT_SETTINGS,
  FONT_PX,
  normalizeSettings,
  resolveTheme,
  SETTINGS_KEY,
  type BlockId,
  type Settings,
} from "@/lib/settings";
import {
  addStop,
  isApproximate,
  isDuplicate,
  MAX_STOPS,
  MSG_APPROX,
  MSG_DUPLICATE,
  MSG_NOT_FOUND,
} from "@/lib/stops";
import type { LegTimeFn, Place, TimeMode } from "@/lib/types";

const BLOCKS_KEY = "rotas:blocos";
/** Blocos abertos por padrão. As Configurações começam recolhidas. */
const BLOCKS_DEFAULT: Record<BlockId, boolean> = {
  inicio: true,
  paradas: true,
  acoes: true,
  resumo: true,
  config: false,
};

/** Último estado da rota, salvo em localStorage. */
interface RouteState {
  start: Place;
  endSame: boolean;
  end: Place | null;
  /** Paradas na ordem em que foram digitadas. A ordem exibida vem do solver. */
  stops: Place[];
  /** Locais travados: id → posição na visita (0 = primeira parada). */
  locks?: Record<string, number>;
  timeMode: TimeMode;
}

const ROUTE_KEY = "rotas:rota:v2";
const ROUTE_DEFAULT: RouteState = {
  start: MOCK_START,
  endSame: true,
  end: null,
  stops: MOCK_TYPED_STOPS,
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
  /** Trecho da linha verde clicado (índice na sequência da rota). */
  leg?: number;
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

export default function RoutePlanner({
  fallbackStyleUrl,
  authEnabled = false,
}: {
  fallbackStyleUrl: string | null;
  /** true quando o site exige senha (mostra o botão "Sair"). */
  authEnabled?: boolean;
}) {
  const [route, setRoute] = useLocalStorageState(ROUTE_KEY, ROUTE_DEFAULT, isRouteState);
  const { start, endSame, end, stops: typedStops, timeMode } = route;
  // Travas válidas para a lista atual (ignora restos de paradas removidas).
  const locks = useMemo(
    () => cleanLocks(typedStops.map((s) => s.id), route.locks ?? {}),
    [typedStops, route.locks],
  );
  const lockCount = Object.keys(locks).length;
  const router = useRouter();
  const [summaryHeight, setSummaryHeight] = useState(0);

  // Preferências de aparência (tema, fonte e posição dos blocos).
  const [storedSettings, setSettings] = useLocalStorageState<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const settings = useMemo(() => normalizeSettings(storedSettings), [storedSettings]);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = resolveTheme(settings.theme, systemDark);
  const fontPx = FONT_PX[settings.fontSize];
  useEffect(() => {
    // O tema e a fonte valem para a página inteira, então ficam no <html>.
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.fontSize = `${fontPx}px`;
  }, [theme, fontPx]);
  const summaryInCorner = settings.summaryDock === "corner";
  const panelLeft = settings.panelSide === "left";
  /** null = "agora" (acompanha o relógio). */
  const [dateTime, setDateTime] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  /** Área visível do mapa, usada como viés na busca por endereço. */
  const bboxRef = useRef<BBoxTuple | null>(null);

  const [openBlocks, setOpenBlocks] = useLocalStorageState(BLOCKS_KEY, BLOCKS_DEFAULT);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const currentMinute = useCurrentMinute();
  const switchId = useId();
  const dateId = useId();

  const isOpen = (id: BlockId) => openBlocks[id] ?? BLOCKS_DEFAULT[id];
  const toggle = (id: BlockId) => setOpenBlocks({ ...BLOCKS_DEFAULT, ...openBlocks, [id]: !isOpen(id) });

  // O aviso some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = (text: string, undoStopId?: string) =>
    setToast({ id: Date.now(), text, undoStopId });

  const finalPlace = endSame ? start : end;

  // Pedido ao servidor (matriz com trânsito + solver). Só muda quando a rota muda:
  // em "agora", o relógio andando NÃO dispara novas consultas (a cota é limitada).
  const requestBody = useMemo(
    () => JSON.stringify(planRequestBody({ start, stops: typedStops, end, endSame, locks, mode: timeMode, dateTime })),
    [start, typedStops, end, endSame, locks, timeMode, dateTime],
  );
  const [remote, setRemote] = useState<{ body: string; outcome: PlanOutcome } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchPlan(requestBody, controller.signal).then((outcome) => {
        if (!controller.signal.aborted) setRemote({ body: requestBody, outcome });
      });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestBody]);

  /** Resposta do servidor para a rota atual; null enquanto calcula ou se falhou. */
  const outcome = remote?.body === requestBody ? remote.outcome : null;
  const serverPlan: PlanResponse | null = outcome?.kind === "ok" ? outcome.plan : null;
  const planStatus: "loading" | "ok" | "failed" | "no-route" =
    !outcome ? "loading" : outcome.kind === "ok" ? "ok" : outcome.kind;

  // Enquanto o servidor não responde (ou se falhar), vale a estimativa local por distância.
  const local = useMemo(() => {
    const constrained = optimizeStops(start, typedStops, finalPlace, estimateLegTime, undefined, locks);
    // Com travas, a melhor ordem livre fica só para comparação.
    const bestSeconds =
      lockCount > 0
        ? optimizeStops(start, typedStops, finalPlace, estimateLegTime).seconds
        : constrained.seconds;
    return { ...constrained, bestSeconds };
  }, [start, typedStops, finalPlace, locks, lockCount]);

  // A melhor ordem vem do solver; a lista e os pins seguem essa ordem.
  const stops = useMemo(() => {
    if (!serverPlan) return local.stops;
    const byId = new Map(typedStops.map((s) => [s.id, s]));
    const ordered = serverPlan.order.map((id) => byId.get(id));
    return ordered.length === typedStops.length && ordered.every((s) => s !== undefined)
      ? (ordered as Place[])
      : local.stops;
  }, [serverPlan, local, typedStops]);

  const legTime = useMemo<LegTimeFn>(() => {
    if (!serverPlan) return estimateLegTime;
    const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
    const known = new Map<string, number>();
    serverPlan.legSeconds.forEach((seconds, i) => {
      if (sequence[i + 1]) known.set(`${sequence[i].id}>${sequence[i + 1].id}`, seconds);
    });
    return (from, to) => {
      const seconds = known.get(`${from.id}>${to.id}`);
      return seconds === undefined
        ? estimateLegTime(from, to)
        : { seconds, estimated: serverPlan.source.estimated };
    };
  }, [serverPlan, start, stops, finalPlace]);

  const typedSeconds = serverPlan?.typedSeconds ?? local.typedSeconds;
  const orderExact = serverPlan?.exact ?? local.exact;
  const bestSeconds = serverPlan?.bestSeconds ?? local.bestSeconds;

  const anchor = useMemo(() => {
    if (dateTime) return new Date(dateTime);
    return currentMinute === null ? null : new Date(currentMinute * 60_000);
  }, [dateTime, currentMinute]);

  const plan = useMemo(() => {
    // Sem caminho de carro, não há tempos para mostrar.
    if (planStatus === "no-route") return null;
    if (!anchor || Number.isNaN(anchor.getTime())) return null;
    const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
    return computePlan(sequence, timeMode, anchor, legTime);
  }, [anchor, start, stops, finalPlace, timeMode, legTime, planStatus]);

  /** Adiciona a parada sobre o estado mais recente. Devolve a mensagem de erro, se houver. */
  const tryAddStop = (place: Place): string | null => {
    let problem: string | null = null;
    setRoute((prev) => {
      const result = addStop(prev.stops, place, fixedPlacesOf(prev));
      if (!result.ok) {
        problem = result.message;
        return prev;
      }
      return { ...prev, stops: result.stops };
    });
    return problem;
  };

  const displayedIds = stops.map((s) => s.id);

  const removeStop = (id: string) =>
    setRoute((prev) => ({
      ...prev,
      stops: prev.stops.filter((s) => s.id !== id),
      locks: removeFromLocks(displayedIds, locks, id),
    }));

  /** Arrastar e soltar: a parada solta fica travada naquela posição. */
  const handleMove = (from: number, to: number) => {
    const moved = moveStop(displayedIds, locks, from, to);
    setRoute((prev) => ({ ...prev, locks: moved.locks }));
  };

  const handleToggleLock = (id: string) =>
    setRoute((prev) => ({ ...prev, locks: toggleLock(displayedIds, locks, id) }));

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
    if (draft) return tryAddStop(makePlace(draft));

    // Não achou: pode ser uma frase com vários locais. A IA só separa o texto em
    // buscas; cada busca passa pela geocodificação normal.
    const parsed = await fetchParsedPlaces(text);
    const queries = parsed.places.filter((query) => query.toLowerCase() !== text.toLowerCase());
    if (queries.length === 0) return MSG_NOT_FOUND;

    const missing: string[] = [];
    let added = 0;
    for (const query of queries) {
      const found = await resolvePlaceInput(query, bboxRef.current);
      if (!found) {
        missing.push(query);
        continue;
      }
      const problem = tryAddStop(makePlace(found));
      if (problem) return added > 0 ? `Adicionei ${added}. ${problem}` : problem;
      added += 1;
    }
    if (added > 0) notify(`IA (${TIER_LABEL[parsed.tier].toLowerCase()}): ${pluralStops(added)} adicionada${added === 1 ? "" : "s"}.`);
    if (missing.length === 0) return null;
    return added > 0 ? `Não encontrei: ${missing.join("; ")}.` : MSG_NOT_FOUND;
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

  const handleLegClick = (leg: number, lat: number, lng: number) => setInfo({ lat, lng, leg, address: null });

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

  // Linha azul: retas entre os pontos. Linha verde: a rota pelas ruas, quando o provedor devolve.
  const path = useMemo<[number, number][]>(() => {
    const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
    return sequence.map((p) => [p.lng, p.lat]);
  }, [start, stops, finalPlace]);
  const streetLegs = useMemo(
    () => serverPlan?.streetLegs?.map((leg) => leg.coordinates) ?? null,
    [serverPlan],
  );

  // Conteúdo do balão quando o clique foi em um trecho da linha verde.
  const legDetails = (() => {
    if (info?.leg === undefined) return null;
    const street = serverPlan?.streetLegs?.[info.leg];
    const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
    const from = sequence[info.leg];
    const to = sequence[info.leg + 1];
    if (!street || !from || !to) return null;
    const planned = plan?.legs[info.leg];
    return (
      <div className="flex w-56 max-w-full flex-col gap-1 pr-4 text-sm text-zinc-900 dark:text-zinc-100">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          <span aria-hidden="true" className="h-2 w-5 rounded-full" style={{ backgroundColor: legColor(info.leg) }} />
          Trecho {info.leg + 1}
        </p>
        <p className="font-semibold">
          {from.label} → {to.label}
        </p>
        <p className="text-base font-semibold">
          {formatKm(street.meters)} · {formatDuration(street.seconds)}
        </p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Distância e tempo médio pelas ruas. Fonte: {serverPlan?.streetSource}.
        </p>
        {planned && !planned.estimated && Math.abs(planned.seconds - street.seconds) >= 60 && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Com o trânsito previsto: {formatDuration(planned.seconds)}.</p>
        )}
      </div>
    );
  })();

  const layout: MapLayout = isDesktop ? "desktop" : sheetOpen ? "sheet-open" : "sheet-closed";

  // Comentário da IA sobre a ordem final. Só rótulos e minutos saem daqui, e só
  // quando o plano muda. Sem IA (ou com menos de 2 paradas) fica o algoritmo local.
  const reviewBody = useMemo(() => {
    if (!serverPlan || stops.length < 2) return null;
    const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
    if (serverPlan.legSeconds.length !== sequence.length - 1) return null;
    return JSON.stringify(
      reviewRequestBody(sequence.map((p) => p.label), serverPlan.legSeconds, endSame, lockCount),
    );
  }, [serverPlan, start, stops, finalPlace, endSame, lockCount]);
  const [aiRemote, setAiRemote] = useState<{ body: string; outcome: ReviewOutcome } | null>(null);

  useEffect(() => {
    if (!reviewBody) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchReview(reviewBody, controller.signal).then((outcome) => {
        if (!controller.signal.aborted) setAiRemote({ body: reviewBody, outcome });
      });
    }, 1500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [reviewBody]);

  const aiOutcome = reviewBody && aiRemote?.body === reviewBody ? aiRemote.outcome : null;
  const aiLoading = reviewBody !== null && aiOutcome === null;
  const aiTier = aiOutcome?.tier ?? "local";

  // Aviso de rota impossível (ex.: locais separados pelo mar).
  const noRouteMessage = (() => {
    if (outcome?.kind !== "no-route") return null;
    const all = [start, ...typedStops, ...(end ? [end] : [])];
    const from = all.find((p) => p.id === outcome.fromId);
    const to = all.find((p) => p.id === outcome.toId);
    const where = from && to ? `entre ${from.label} e ${to.label}` : "ligando todos os locais";
    return `Não existe caminho de carro ${where}. Balsas não contam; pontes e túneis, sim.`;
  })();

  // Espaço do mapa coberto pelo HUD no desktop: o painel (20rem + margem) de um lado
  // e, quando fica no canto, a altura do Resumo embaixo.
  const desktopInsets = useMemo(() => {
    const panel = isDesktop ? 20 * fontPx + 16 : 0;
    return {
      left: panelLeft ? panel : 0,
      right: panelLeft ? 0 : panel,
      bottom: isDesktop && summaryInCorner ? summaryHeight + 32 : 0,
    };
  }, [isDesktop, fontPx, panelLeft, summaryInCorner, summaryHeight]);

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

  // Blocos do painel. A ordem em que aparecem vem das configurações.
  const blocks: Record<BlockId, ReactNode> = {
    inicio: (
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
    ),
    paradas: (
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
                <>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Arraste pela alça para reposicionar: o local solto fica travado ali (cadeado). Os
                    destravados são otimizados em volta.
                  </p>
                  <StopList
                    stops={stops}
                    legs={plan?.legs}
                    locks={locks}
                    showLegColors={streetLegs !== null}
                    onMove={handleMove}
                    onToggleLock={handleToggleLock}
                    onRemove={removeStop}
                  />
                </>
              )}

              {noRouteMessage && (
                <p role="alert" className="rounded-lg bg-red-100 px-2.5 py-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
                  {noRouteMessage}
                </p>
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
    ),
    acoes: (
          <CollapsibleCard
            id="bloco-acoes"
            title="Abrir e compartilhar"
            summary="Google Maps, Waze, copiar"
            open={isOpen("acoes")}
            onToggle={() => toggle("acoes")}
          >
            <ActionsPanel
              start={start}
              stops={stops}
              finalPlace={finalPlace}
              roundTrip={endSame}
              plan={plan}
              isMobile={!isDesktop}
              onNotify={notify}
            />
          </CollapsibleCard>
    ),
    resumo: (
          <CollapsibleCard
            id="bloco-resumo"
            title="Resumo"
            summary={`${totalText} · chega ${arriveText}`}
            open={isOpen("resumo")}
            onToggle={() => toggle("resumo")}
            className={
              !summaryInCorner
                ? ""
                : panelLeft
                  ? "md:fixed md:bottom-8 md:right-4 md:z-10 md:w-80"
                  : "md:fixed md:bottom-8 md:left-4 md:z-10 md:w-80"
            }
            collapseTo={isDesktop && summaryInCorner ? "down" : "up"}
            onHeightChange={setSummaryHeight}
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
                  "A ordem atual não é mais rápida que a digitada."
                )}
              </p>

              {lockCount > 0 && plan && (
                <p>
                  {lockCount === 1 ? "1 local travado." : `${lockCount} locais travados.`}{" "}
                  {plan.totalSeconds - bestSeconds >= 60 ? (
                    <strong className="font-semibold text-amber-800 dark:text-amber-300">
                      Sem travas, a rota levaria {formatDuration(bestSeconds)} (
                      {Math.round((plan.totalSeconds - bestSeconds) / 60)} min a menos).
                    </strong>
                  ) : (
                    "Mesmo assim, esta é a ordem mais rápida."
                  )}
                </p>
              )}

              <ul className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                <li aria-live="polite">
                  Fonte:{" "}
                  {planStatus === "ok" && serverPlan
                    ? serverPlan.source.label
                    : planStatus === "no-route"
                      ? "sem caminho de carro entre os locais"
                      : planStatus === "loading"
                        ? "calculando… (estimativa por distância enquanto isso)"
                      : "servidor indisponível; estimativa por distância, sem previsão de trânsito"}
                  .
                </li>
                <li>
                  Ordem:{" "}
                  {orderExact ? "exata" : "aproximada"}
                  {lockCount > 0 ? ", respeitando os locais travados" : orderExact ? " (a melhor possível)" : ""}.
                </li>
                {serverPlan?.checkedSeconds != null && (
                  <li>
                    Pelas ruas (linha colorida): {formatDuration(serverPlan.checkedSeconds)}. Clique na linha
                    para ver cada trecho.
                  </li>
                )}
                {serverPlan?.arrival && !serverPlan.arrival.converged && (
                  <li>O horário de saída ainda oscila com o trânsito; trate-o como aproximado.</li>
                )}
              </ul>

              <div className="flex flex-col gap-1.5 border-t border-zinc-200 pt-2.5 dark:border-zinc-700" aria-live="polite">
                <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <Badge>{TIER_LABEL[aiTier]}</Badge>
                  {aiLoading
                    ? "Consultando a IA…"
                    : aiOutcome?.review
                      ? `Comentário da IA: ${aiOutcome.provider}`
                      : stops.length < 2
                        ? "Algoritmo local"
                        : "Algoritmo local (nenhuma IA respondeu)"}
                </p>
                {aiOutcome?.review && (
                  <>
                    <p className="text-xs leading-relaxed">{aiOutcome.review.explanation}</p>
                    {aiOutcome.review.backtracking && (
                      <p className="rounded-lg bg-amber-100 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        A IA viu um possível vai-e-volta nesta ordem.
                      </p>
                    )}
                    {aiOutcome.review.suggestion && (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        Sugestão da IA (não aplicada): {aiOutcome.review.suggestion}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </CollapsibleCard>
    ),
    config: (
          <CollapsibleCard
            id="bloco-config"
            title="Configurações"
            summary="Tema, fonte e blocos"
            open={isOpen("config")}
            onToggle={() => toggle("config")}
          >
            <SettingsPanel
              settings={settings}
              onChange={setSettings}
              onLogout={
                authEnabled
                  ? () => {
                      void fetch("/api/login", { method: "DELETE" }).finally(() => {
                        router.replace("/login");
                        router.refresh();
                      });
                    }
                  : undefined
              }
            />
          </CollapsibleCard>
    ),
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <h1 className="sr-only">Planejador de rotas</h1>

      <MapView
        points={points}
        path={path}
        streetLegs={streetLegs}
        onLegClick={handleLegClick}
        desktopInsets={desktopInsets}
        controlsSide={panelLeft ? "right" : "left"}
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
        {legDetails}
        {info && info.leg === undefined && (
          <PlacePopup
            title={infoPlace ? infoPlace.label : (info.address ?? null)}
            role={
              !infoPlace
                ? undefined
                : infoPlace.id === start.id
                  ? "Início da rota"
                  : infoIsStop
                    ? `Parada ${stops.findIndex((s) => s.id === infoPlace.id) + 1}`
                    : "Fim da rota"
            }
            address={info.address}
            lat={info.lat}
            lng={info.lng}
            onCopy={() => {
              const text = `${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}`;
              void navigator.clipboard?.writeText(text).then(
                () => notify("Coordenadas copiadas."),
                () => notify("Não foi possível copiar."),
              );
            }}
            actions={
              infoPlace
                ? []
                : [
                    {
                      badge: String(Math.min(stops.length + 1, MAX_STOPS)),
                      title: "Adicionar como parada",
                      description:
                        stops.length >= MAX_STOPS
                          ? "Limite de 20 paradas atingido"
                          : "Entra na rota e a ordem é recalculada",
                      primary: true,
                      disabled: stops.length >= MAX_STOPS,
                      onClick: () => {
                        const place = placeFromInfo(info);
                        const problem = tryAddStop(place);
                        if (problem) notify(problem);
                        else {
                          notify("Parada adicionada.", place.id);
                          setInfo(null);
                        }
                      },
                    },
                    {
                      badge: "A",
                      title: "Definir como início",
                      description: `Substitui ${start.label}`,
                      onClick: () => {
                        const problem = setFixed("start", placeFromInfo(info));
                        if (problem) notify(problem);
                        else setInfo(null);
                      },
                    },
                    {
                      badge: "B",
                      title: "Definir como fim",
                      description:
                        !endSame && end ? `Substitui ${end.label}` : "A rota deixa de voltar ao início",
                      onClick: () => {
                        const problem = setFixed("end", placeFromInfo(info));
                        if (problem) notify(problem);
                        else setInfo(null);
                      },
                    },
                  ]
            }
            footer={
              infoPlace && infoIsStop ? (
                <button
                  type="button"
                  className="focus-ring self-start rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-zinc-600 dark:text-red-400 dark:hover:bg-red-950"
                  onClick={() => {
                    removeStop(infoPlace.id);
                    setInfo(null);
                  }}
                >
                  Remover parada
                </button>
              ) : undefined
            }
          />
        )}
      </MapView>

      <aside
        aria-label="Planejamento da rota"
        className={`fixed inset-x-0 bottom-0 z-10 flex max-h-[60dvh] flex-col rounded-t-2xl bg-zinc-100/95 shadow-[0_-4px_24px_rgba(0,0,0,0.2)] backdrop-blur md:pointer-events-none md:absolute md:inset-x-auto md:bottom-4 md:top-4 ${
          panelLeft ? "md:left-4" : "md:right-4"
        } md:max-h-none md:w-80 md:rounded-none md:bg-transparent md:shadow-none md:backdrop-blur-none dark:bg-zinc-950/95 md:dark:bg-transparent`}
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
          inert={!isDesktop && !sheetOpen}
          className={`grid min-h-0 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none md:grid-rows-[1fr] ${
            sheetOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 md:p-0 md:pr-1">
            {settings.blockOrder.map((id) => (
              <Fragment key={id}>{blocks[id]}</Fragment>
            ))}
            <div aria-hidden="true" className="h-0 shrink-0 md:hidden" />
          </div>
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
