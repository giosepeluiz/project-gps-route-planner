"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import ActionsPanel from "./ActionsPanel";
import CollapsibleCard, { Chevron, type HeaderDrag } from "./CollapsibleCard";
import MapView, { type MapLayout, type MapPoint } from "./MapView";
import PlaceField, { inputClass } from "./PlaceField";
import PlacePopup from "./PlacePopup";
import AboutDialog from "./AboutDialog";
import InfoTip from "./InfoTip";
import Tour, { type TourStep } from "./Tour";
import TripWarningDialog from "./TripWarningDialog";
import { I18nProvider, useResolvedLocale } from "./I18nProvider";
import SettingsDialog from "./SettingsDialog";
import StopList from "./StopList";
import { useBlockDrag } from "./useBlockDrag";
import { freeRect, freeStyle, placeBlock, sheetOrder } from "@/lib/block-layout";
import {
  formatDuration,
  formatKm,
  formatLatLng,
  formatTime,
  formatTimeWithDay,
  toLocalInputValue,
} from "@/lib/format";
import { useCurrentMinute, useLocalStorageState, useMediaQuery } from "@/lib/hooks";
import {
  fetchParsedPlaces,
  fetchReview,
  judgeSuggestion,
  locksFromSuggestion,
  reviewRequestBody,
  type ReviewOutcome,
} from "@/lib/ai-client";
import { legColor } from "@/lib/leg-colors";
import { cleanLocks, moveStop, removeFromLocks, toggleLock } from "@/lib/locks";
import { EMPTY_ROUTE, fixedPlacesOf, isRouteState, normalizeRoute, ROUTE_KEY, type RouteState } from "@/lib/route-state";
import { optimizeStops } from "@/lib/optimize";
import {
  areaLabel,
  fetchSuggestions,
  isCoordinateLabel,
  type AddressSuggestion,
  resolvePlaceInput,
  reverseLabel,
  type BBoxTuple,
  type PlaceDraft,
} from "@/lib/place-input";
import { computePlan, estimateLegTime } from "@/lib/plan";
import { fetchPlan, planRequestBody, type PlanOutcome } from "@/lib/plan-client";
import type { PlanResponse } from "@/lib/server/plan";
import {
  BLOCK_IDS,
  DEFAULT_SETTINGS,
  EDGE_MARGIN,
  FONT_PX,
  normalizeSettings,
  resolveTheme,
  SETTINGS_KEY,
  type BlockId,
  type Settings,
} from "@/lib/settings";
import { addStop, isApproximate, isDuplicate, MAX_STOPS } from "@/lib/stops";
import { MESSAGES } from "@/lib/messages";
import { MAX_DWELL_MINUTES, type LegTimeFn, type Place } from "@/lib/types";
import {
  hasArrived,
  remainingRoute,
  routeMeters,
  shouldReplan,
  tripTarget,
  type Fix,
  type TripStatus,
} from "@/lib/trip";

const BLOCKS_KEY = "rotas:blocos";
/** Blocos abertos por padrão. */
const BLOCKS_DEFAULT: Record<BlockId, boolean> = {
  inicio: true,
  paradas: true,
  acoes: false,
  resumo: true,
};

/** Largura dos blocos no desktop (rem): ~322 px no texto pequeno. */
const BLOCK_WIDTH_REM = 23;

/** Como cada bloco é desenhado: na gaveta do celular, numa coluna ou solto. */
interface BlockOptions {
  variant: "section" | "card";
  collapseTo?: "up" | "down";
  headerDrag?: HeaderDrag;
  blockRef?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  className?: string;
}

/** Estrelinhas de IA, ao lado do nome da camada que respondeu. */
function Sparkles() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-accent" fill="currentColor">
      <path d="M8 2.5l1.35 3.9a2 2 0 001.25 1.25L14.5 9l-3.9 1.35a2 2 0 00-1.25 1.25L8 15.5l-1.35-3.9a2 2 0 00-1.25-1.25L1.5 9l3.9-1.35a2 2 0 001.25-1.25z" />
      <path d="M15 11.5l.65 1.85a1 1 0 00.6.6l1.85.65-1.85.65a1 1 0 00-.6.6L15 17.7l-.65-1.85a1 1 0 00-.6-.6L11.9 14.6l1.85-.65a1 1 0 00.6-.6z" />
    </svg>
  );
}

const iconProps = {
  "aria-hidden": true,
  viewBox: "0 0 20 20",
  className: "h-4 w-4 shrink-0",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function PlayIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6.5 4.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 4.5v11M13 4.5v11" strokeWidth={2.6} />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  );
}
function FlagIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 17V3.5M5 4h9l-2 3 2 3H5" />
    </svg>
  );
}
/** Alvo do GPS ("usar minha localização"). */
function LocateIcon({ busy }: { busy: boolean }) {
  if (busy) {
    return (
      <svg {...iconProps} className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none">
        <path d="M10 3a7 7 0 107 7" />
      </svg>
    );
  }
  return (
    <svg {...iconProps}>
      <circle cx="10" cy="10" r="5.5" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" />
      <path d="M10 1.8v2.7M10 15.5v2.7M1.8 10h2.7M15.5 10h2.7" />
    </svg>
  );
}

/** Tutorial do primeiro uso: guardado como visto depois de concluir ou pular. */
const TOUR_KEY = "rotas:tutorial:v1";

/** Posição atual como local da rota (início da rota que falta, na viagem). */
const herePlace = (point: { lat: number; lng: number }, label: string): Place => ({
  id: "gps-aqui",
  label,
  lat: point.lat,
  lng: point.lng,
  source: "pin",
  confidence: 1,
  dwellMinutes: 0,
});

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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-px text-2xs font-semibold text-ink-2">
      {children}
    </span>
  );
}

export default function RoutePlanner({ fallbackStyleUrl }: { fallbackStyleUrl: string | null }) {
  // Rota guardada. Sem nada guardado (ou só com o exemplo antigo), começa vazia;
  // o que a pessoa preencher é salvo no localStorage.
  const [storedRoute, setStoredRoute] = useLocalStorageState<RouteState>(ROUTE_KEY, EMPTY_ROUTE, isRouteState);
  const route = useMemo(() => normalizeRoute(storedRoute), [storedRoute]);
  const setRoute = useCallback(
    (next: RouteState | ((previous: RouteState) => RouteState)) =>
      setStoredRoute((previous) => (typeof next === "function" ? next(normalizeRoute(previous)) : next)),
    [setStoredRoute],
  );
  const { start, endSame, end, stops: typedStops, timeMode } = route;
  // Travas válidas para a lista atual (ignora restos de paradas removidas).
  const locks = useMemo(
    () => cleanLocks(typedStops.map((s) => s.id), route.locks ?? {}),
    [typedStops, route.locks],
  );
  const lockCount = Object.keys(locks).length;

  // Preferências (tema, fonte, permanência padrão e posição dos blocos).
  const [storedSettings, setStoredSettings] = useLocalStorageState<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const settings = useMemo(() => normalizeSettings(storedSettings), [storedSettings]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourSeen, setTourSeen] = useLocalStorageState<boolean>(TOUR_KEY, false);
  /** Sobe ao pedir o tutorial de novo, para ele recomeçar do primeiro passo. */
  const [tourRun, setTourRun] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** Sobe quando os blocos mudam de lugar ou de tamanho de texto: o mapa reenquadra a rota. */
  const [fitVersion, setFitVersion] = useState(0);
  const setSettings = (next: Settings) => {
    if (next.fontSize !== settings.fontSize || JSON.stringify(next.layout) !== JSON.stringify(settings.layout)) {
      setFitVersion((v) => v + 1);
    }
    setStoredSettings(next);
  };
  // Idioma: o escolhido nas configurações ou, em "Sistema", o do aparelho.
  const locale = useResolvedLocale(settings.language);
  const t = MESSAGES[locale];
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const blockDrag = useBlockDrag(settings.layout, (id, target) =>
    setSettings({ ...settings, layout: placeBlock(settings.layout, id, target) }),
  );
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = resolveTheme(settings.theme, systemDark);
  const fontPx = FONT_PX[settings.fontSize];
  useEffect(() => {
    // O tema e a fonte valem para a página inteira, então ficam no <html>.
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.fontSize = `${fontPx}px`;
  }, [theme, fontPx]);
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

  // "Abrir e compartilhar" sempre começa recolhido: o estado dele não é guardado.
  const [actionsOpen, setActionsOpen] = useState(false);
  const isOpen = (id: BlockId) => (id === "acoes" ? actionsOpen : (openBlocks[id] ?? BLOCKS_DEFAULT[id]));
  const toggle = (id: BlockId) => {
    if (id === "acoes") setActionsOpen((open) => !open);
    else setOpenBlocks({ ...BLOCKS_DEFAULT, ...openBlocks, [id]: !isOpen(id) });
  };

  // O aviso some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = (text: string, undoStopId?: string) =>
    // O id muda a cada aviso, para a animação e o tempo de exibição recomeçarem.
    setToast((previous) => ({ id: (previous?.id ?? 0) + 1, text, undoStopId }));

  const finalPlace = endSame ? start : end;
  /** Sequência da visita: início, paradas e fim (o que já existir). */
  const sequenceOf = useCallback(
    (list: readonly Place[]): Place[] => [...(start ? [start] : []), ...list, ...(finalPlace ? [finalPlace] : [])],
    [start, finalPlace],
  );

  // Pedido ao servidor (matriz com trânsito + solver). Só muda quando a rota muda:
  // em "agora", o relógio andando NÃO dispara novas consultas (a cota é limitada).
  // Sem início ainda não há rota para calcular.
  const requestBody = useMemo(
    () =>
      start
        ? JSON.stringify(planRequestBody({ start, stops: typedStops, end, endSame, locks, mode: timeMode, dateTime }))
        : null,
    [start, typedStops, end, endSame, locks, timeMode, dateTime],
  );
  const [remote, setRemote] = useState<{ body: string; outcome: PlanOutcome } | null>(null);

  useEffect(() => {
    if (!requestBody) return;
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
  const outcome = requestBody && remote?.body === requestBody ? remote.outcome : null;
  const serverPlan: PlanResponse | null = outcome?.kind === "ok" ? outcome.plan : null;
  const planStatus: "loading" | "ok" | "failed" | "no-route" =
    !outcome ? "loading" : outcome.kind === "ok" ? "ok" : outcome.kind;

  // Enquanto o servidor não responde (ou se falhar), vale a estimativa local por distância.
  const local = useMemo(() => {
    if (!start) return { stops: [...typedStops], seconds: 0, typedSeconds: 0, exact: true, bestSeconds: 0 };
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
    const sequence = sequenceOf(stops);
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
  }, [sequenceOf, serverPlan, stops]);

  const typedSeconds = serverPlan?.typedSeconds ?? local.typedSeconds;
  const orderExact = serverPlan?.exact ?? local.exact;
  const bestSeconds = serverPlan?.bestSeconds ?? local.bestSeconds;

  const anchor = useMemo(() => {
    if (dateTime) return new Date(dateTime);
    return currentMinute === null ? null : new Date(currentMinute * 60_000);
  }, [dateTime, currentMinute]);

  const plan = useMemo(() => {
    // Sem caminho de carro, não há tempos para mostrar.
    // Sem início ainda não há rota; sem caminho de carro, não há tempos para mostrar.
    if (!start || planStatus === "no-route") return null;
    if (!anchor || Number.isNaN(anchor.getTime())) return null;
    const sequence = sequenceOf(stops);
    return computePlan(sequence, timeMode, anchor, legTime);
  }, [sequenceOf, anchor, start, stops, timeMode, legTime, planStatus]);

  /** Distância total da rota: pelas ruas, quando o provedor devolve; senão, estimada. */
  const totalDistance = useMemo(
    () => (start ? routeMeters(sequenceOf(stops), serverPlan?.streetLegs) : null),
    [start, sequenceOf, stops, serverPlan],
  );

  /** Adiciona a parada sobre o estado mais recente. Devolve a mensagem de erro, se houver. */
  const tryAddStop = (newPlace: Place): string | null => {
    // Toda parada nova recebe a permanência padrão das configurações.
    const place = { ...newPlace, dwellMinutes: settings.defaultDwellMinutes };
    let problem: string | null = null;
    setRoute((prev) => {
      const result = addStop(prev.stops, place, fixedPlacesOf(prev));
      if (!result.ok) {
        problem = result.reason === "limit" ? t.stops.limit(MAX_STOPS) : t.stops.duplicate;
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

  // Local digitado como coordenadas (ou link com coordenadas): troca o rótulo
  // pelo nome da zona (bairro ou freguesia, e a cidade), para ficar fácil de
  // reconhecer na lista, no Resumo e no comentário da IA. Uma tentativa por local.
  const zoneTried = useRef(new Set<string>());
  useEffect(() => {
    const places = [route.start, ...route.stops, route.end].filter((p): p is Place => p !== null);
    for (const place of places) {
      if (zoneTried.current.has(place.id) || !isCoordinateLabel(place)) continue;
      zoneTried.current.add(place.id);
      const original = place.label;
      void areaLabel(place).then((zone) => {
        if (!zone) return;
        // Só troca se o rótulo ainda for a coordenada (o usuário pode ter mudado o local).
        const rename = (p: Place) => (p.id === place.id && p.label === original ? { ...p, label: zone } : p);
        setRoute((prev) => ({
          ...prev,
          start: prev.start ? rename(prev.start) : prev.start,
          end: prev.end ? rename(prev.end) : prev.end,
          stops: prev.stops.map(rename),
        }));
      });
    }
  }, [route.start, route.stops, route.end, setRoute]);

  /** Paradas concluídas que ainda estão na rota. */
  const doneIds = useMemo(
    () => new Set((route.done ?? []).filter((id) => typedStops.some((s) => s.id === id))),
    [route.done, typedStops],
  );

  /**
   * Concluir (ou desfazer) uma parada. Ao concluir, ela também fica travada na
   * posição atual, para a ordem não mudar embaixo do que já foi feito.
   */
  const toggleDone = (id: string) => {
    const wasDone = doneIds.has(id);
    setRoute((prev) => {
      const done = new Set(prev.done ?? []);
      if (wasDone) done.delete(id);
      else done.add(id);
      const position = displayedIds.indexOf(id);
      const nextLocks = !wasDone && position !== -1 ? { ...locks, [id]: position } : prev.locks;
      return { ...prev, done: [...done], locks: nextLocks };
    });
    if (!wasDone) {
      const place = typedStops.find((s) => s.id === id);
      notify(t.stops.done(place?.label ?? t.stops.fallbackName));
    }
  };

  /** Trechos concluídos no mapa: o trecho i chega na parada i. */
  const doneLegs = useMemo(
    () => stops.flatMap((s, i) => (doneIds.has(s.id) ? [i] : [])),
    [stops, doneIds],
  );

  // ---------- Viagem acompanhada pelo GPS ----------
  const [trip, setTrip] = useState<{ status: TripStatus; arrivedId?: string } | null>(null);
  const [tripWarning, setTripWarning] = useState(false);
  /** Última leitura do GPS. */
  const [fix, setFix] = useState<Fix | null>(null);
  /** Posição usada no último recálculo (só muda de tempos em tempos, para poupar a cota). */
  const [tripOrigin, setTripOrigin] = useState<Fix | null>(null);
  const lastReplanRef = useRef<Fix | null>(null);
  const target = start ? tripTarget(stops, doneIds, finalPlace) : null;
  const pendingStops = useMemo(() => stops.filter((s) => !doneIds.has(s.id)), [stops, doneIds]);

  const onFix = useEffectEvent((next: Fix) => {
    setFix(next);
    if (shouldReplan(lastReplanRef.current, next)) {
      lastReplanRef.current = next;
      setTripOrigin(next);
    }
    if (!target) {
      setTrip({ status: "finished" });
      return;
    }
    if (!hasArrived(next, target)) return;
    // Chegou: numa parada, pausa até a pessoa retomar; no ponto final, a viagem acaba.
    const isStop = stops.some((s) => s.id === target.id);
    setTrip(isStop ? { status: "arrived", arrivedId: target.id } : { status: "finished" });
  });
  const onGpsError = useEffectEvent((error: GeolocationPositionError) => {
    // Sem permissão não há o que acompanhar; falhas passageiras (túnel, sinal fraco) são ignoradas.
    if (error.code !== error.PERMISSION_DENIED) return;
    notify(t.gps.denied);
    setTrip((current) => (current?.status === "running" ? { status: "paused" } : current));
  });
  const tripRunning = trip?.status === "running";
  useEffect(() => {
    if (!tripRunning) return;
    const watch = navigator.geolocation.watchPosition(
      (position) =>
        onFix({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          at: position.timestamp,
        }),
      (error) => onGpsError(error),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [tripRunning]);

  // Rota que falta, saindo da posição atual: as paradas pendentes na ordem combinada e o fim.
  const tripActive = trip !== null && trip.status !== "finished";
  const tripRequest = useMemo(() => {
    if (!tripActive || !tripOrigin) return null;
    const route = remainingRoute(herePlace(tripOrigin, t.gps.here), pendingStops, finalPlace);
    if (route.stops.length === 0 && !route.end) return null;
    return {
      body: JSON.stringify(planRequestBody({ ...route, mode: "depart", dateTime: null })),
      sequence: [route.start, ...route.stops, ...(route.end ? [route.end] : [])],
    };
  }, [tripActive, tripOrigin, pendingStops, finalPlace, t.gps.here]);
  const [tripRemote, setTripRemote] = useState<{
    body: string;
    sequence: Place[];
    outcome: PlanOutcome;
  } | null>(null);
  useEffect(() => {
    if (!tripRequest) return;
    const controller = new AbortController();
    void fetchPlan(tripRequest.body, controller.signal).then((result) => {
      if (!controller.signal.aborted) setTripRemote({ ...tripRequest, outcome: result });
    });
    return () => controller.abort();
  }, [tripRequest]);

  /** O que o mapa e o Resumo mostram durante a viagem (a última resposta boa, até chegar a nova). */
  const tripView = useMemo(() => {
    if (!tripActive || tripRemote?.outcome.kind !== "ok" || currentMinute === null) return null;
    const tripPlan = tripRemote.outcome.plan;
    const sequence = tripRemote.sequence;
    if (tripPlan.legSeconds.length !== sequence.length - 1) return null;
    const known = new Map<string, number>();
    tripPlan.legSeconds.forEach((seconds, i) => known.set(`${sequence[i].id}>${sequence[i + 1].id}`, seconds));
    const legTimeFn: LegTimeFn = (from, to) => {
      const seconds = known.get(`${from.id}>${to.id}`);
      return seconds === undefined ? estimateLegTime(from, to) : { seconds, estimated: tripPlan.source.estimated };
    };
    return {
      sequence,
      server: tripPlan,
      plan: computePlan(sequence, "depart", new Date(currentMinute * 60_000), legTimeFn),
      // Cada trecho mantém a cor da parada a que chega (a mesma da lista).
      colors: sequence.slice(1).map((p) => {
        const i = stops.findIndex((s) => s.id === p.id);
        return legColor(i === -1 ? stops.length : i);
      }),
    };
  }, [tripActive, tripRemote, currentMinute, stops]);

  const clearTrip = () => {
    lastReplanRef.current = null;
    setFix(null);
    setTripOrigin(null);
    setTripRemote(null);
    setInfo(null);
  };
  const beginTrip = () => {
    setTripWarning(false);
    if (!("geolocation" in navigator)) {
      notify(t.gps.unsupported);
      return;
    }
    clearTrip();
    setTrip({ status: "running" });
  };
  const resumeTrip = () => {
    // Retomar depois de chegar: a parada fica concluída e o acompanhamento segue para a próxima.
    if (trip?.status === "arrived" && trip.arrivedId && !doneIds.has(trip.arrivedId)) toggleDone(trip.arrivedId);
    lastReplanRef.current = null;
    setTrip({ status: "running" });
  };
  const endTrip = () => {
    clearTrip();
    setTrip(null);
  };

  /** Aceita a ordem da IA: cada parada fica travada na posição sugerida (dá para destravar depois). */
  const acceptSuggestion = (suggestedStops: readonly number[]) => {
    const next = locksFromSuggestion(displayedIds, suggestedStops);
    if (!next) {
      notify(t.ai.stale);
      return;
    }
    setRoute((prev) => ({ ...prev, locks: next }));
    notify(t.ai.accepted(t.common.stops(displayedIds.length)));
  };

  const setDwell = (id: string, minutes: number) =>
    setRoute((prev) => ({
      ...prev,
      stops: prev.stops.map((s) =>
        s.id === id ? { ...s, dwellMinutes: Math.max(0, Math.min(Math.round(minutes), MAX_DWELL_MINUTES)) } : s,
      ),
    }));

  const handleToggleLock = (id: string) =>
    setRoute((prev) => ({ ...prev, locks: toggleLock(displayedIds, locks, id) }));

  const setFixed = (which: "start" | "end", place: Place): string | null => {
    let problem: string | null = null;
    setRoute((prev) => {
      if (isDuplicate(place, prev.stops)) {
        problem = t.stops.duplicate;
        return prev;
      }
      return which === "start" ? { ...prev, start: place } : { ...prev, end: place, endSame: false };
    });
    return problem;
  };

  /** Início ou fim pela localização do aparelho; o rótulo vira o endereço quando chegar. */
  const [locating, setLocating] = useState<"start" | "end" | null>(null);
  const locateMe = (which: "start" | "end") => {
    if (!("geolocation" in navigator)) {
      notify(t.gps.unsupported);
      return;
    }
    setLocating(which);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        const place = makePlace({ lat, lng, label: pinLabel(lat, lng), source: "pin", confidence: 1 });
        setLocating(null);
        const problem = setFixed(which, place);
        if (problem) {
          notify(problem);
          return;
        }
        void reverseLabel({ lat, lng }).then((address) => {
          if (!address) return;
          const rename = (p: Place | null) => (p && p.id === place.id ? { ...p, label: address } : p);
          setRoute((prev) => ({ ...prev, start: rename(prev.start), end: rename(prev.end) }));
        });
      },
      (error) => {
        setLocating(null);
        notify(error.code === error.PERMISSION_DENIED ? t.gps.denied : t.gps.failed);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };
  const gpsButton = (which: "start" | "end") => (
    <button
      type="button"
      onClick={() => locateMe(which)}
      disabled={locating !== null}
      aria-label={locating === which ? t.gps.locating : t.gps.use}
      title={t.gps.use}
      className="focus-ring grid w-[2.6rem] shrink-0 self-stretch place-items-center rounded-lg border border-line text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-hover hover:text-accent disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
    >
      <LocateIcon busy={locating === which} />
    </button>
  );

  const submitStop = async (text: string): Promise<string | null> => {
    const draft = await resolvePlaceInput(text, bboxRef.current);
    if (draft) return tryAddStop(makePlace(draft));

    // Não achou: pode ser uma frase com vários locais. A IA só separa o texto em
    // buscas; cada busca passa pela geocodificação normal.
    const parsed = await fetchParsedPlaces(text);
    const queries = parsed.places.filter((query) => query.toLowerCase() !== text.toLowerCase());
    if (queries.length === 0) return t.stops.notFound;

    const missing: string[] = [];
    let added = 0;
    for (const query of queries) {
      const found = await resolvePlaceInput(query, bboxRef.current);
      if (!found) {
        missing.push(query);
        continue;
      }
      const problem = tryAddStop(makePlace(found));
      if (problem) return added > 0 ? t.stops.addedSome(added, problem) : problem;
      added += 1;
    }
    if (added > 0) notify(t.ai.added(t.ai.tiers[parsed.tier].toLowerCase(), t.common.stops(added)));
    if (missing.length === 0) return null;
    return added > 0 ? t.stops.notFoundList(missing.join("; ")) : t.stops.notFound;
  };

  /** Autocompletar: sugestões perto da área visível do mapa. */
  const suggestAddresses = (text: string, signal: AbortSignal) => {
    const box = bboxRef.current;
    const near = box ? { lat: (box[1] + box[3]) / 2, lng: (box[0] + box[2]) / 2 } : null;
    return fetchSuggestions(text, near, signal);
  };
  /** Local escolhido numa sugestão: já vem com as coordenadas, sem nova busca. */
  const placeFromSuggestion = (s: AddressSuggestion) =>
    makePlace({ lat: s.lat, lng: s.lng, label: s.label, source: "address", confidence: 1 });

  const submitFixed = async (text: string, which: "start" | "end"): Promise<string | null> => {
    const draft = await resolvePlaceInput(text, bboxRef.current);
    return draft ? setFixed(which, makePlace(draft)) : t.stops.notFound;
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
    notify(t.stops.added, place.id);
    void reverseLabel({ lat, lng }).then((address) => {
      if (!address) return;
      setRoute((prev) => ({
        ...prev,
        stops: prev.stops.map((s) => (s.id === place.id ? { ...s, label: address } : s)),
      }));
    });
  };

  const handleLegClick = (leg: number, lat: number, lng: number) => setInfo({ lat, lng, leg, address: null });

  /** Todos os locais da rota: início, paradas e fim. */
  const routePlaces = [start, ...stops, end].filter((p): p is Place => p !== null);

  const handlePointClick = (id: string) => {
    const place = routePlaces.find((p) => p.id === id);
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
    ? routePlaces.find((p) => p.id === info.placeId)
    : undefined;
  const infoIsStop = !!infoPlace && stops.some((s) => s.id === infoPlace.id);

  // Pins e linha do mapa.
  const points = useMemo<MapPoint[]>(() => {
    const list: MapPoint[] = [
      ...(start
        ? [{ id: start.id, lat: start.lat, lng: start.lng, kind: "start" as const, badge: "A", title: start.label }]
        : []),
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
    const sequence = sequenceOf(stops);
    return sequence.map((p) => [p.lng, p.lat]);
  }, [sequenceOf, stops]);
  const streetLegs = useMemo(
    () => serverPlan?.streetLegs?.map((leg) => leg.coordinates) ?? null,
    [serverPlan],
  );

  // O mapa mostra a rota planejada ou, na viagem, a rota que falta a partir da posição atual.
  const view = useMemo(
    () =>
      tripView ?? {
        sequence: sequenceOf(stops),
        server: serverPlan,
        plan,
        colors: (serverPlan?.streetLegs ?? []).map((_, i) => legColor(i)),
      },
    [tripView, sequenceOf, stops, serverPlan, plan],
  );
  const mapPath = useMemo<[number, number][]>(
    () => (tripView ? tripView.sequence.map((p) => [p.lng, p.lat]) : path),
    [tripView, path],
  );
  const mapStreetLegs = useMemo(
    () => (tripView ? (tripView.server.streetLegs?.map((leg) => leg.coordinates) ?? null) : streetLegs),
    [tripView, streetLegs],
  );

  // Conteúdo do balão quando o clique foi em um trecho da linha verde.
  const legDetails = (() => {
    if (info?.leg === undefined) return null;
    const street = view.server?.streetLegs?.[info.leg];
    const sequence = view.sequence;
    const from = sequence[info.leg];
    const to = sequence[info.leg + 1];
    if (!street || !from || !to) return null;
    const planned = view.plan?.legs[info.leg];
    return (
      <div className="flex w-56 max-w-full flex-col gap-1 pr-4 text-sm text-ink">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          <span aria-hidden="true" className="h-2 w-5 rounded-full" style={{ backgroundColor: view.colors[info.leg] ?? legColor(info.leg) }} />
          {t.leg.title(info.leg + 1)}
        </p>
        <p className="font-semibold">
          {from.label} → {to.label}
        </p>
        <p className="text-base font-semibold">
          {formatKm(street.meters)} · {formatDuration(street.seconds)}
        </p>
        <p className="text-xs text-muted">{t.leg.note(view.server?.streetSource ?? "")}</p>
        {planned && !planned.estimated && Math.abs(planned.seconds - street.seconds) >= 60 && (
          <p className="text-xs text-muted">{t.leg.traffic(formatDuration(planned.seconds))}</p>
        )}
      </div>
    );
  })();

  const layout: MapLayout = isDesktop ? "desktop" : sheetOpen ? "sheet-open" : "sheet-closed";

  // Comentário da IA sobre a ordem final. Só rótulos e minutos saem daqui, e só
  // quando o plano muda. Sem IA (ou com menos de 2 paradas) fica o algoritmo local.
  const reviewBody = useMemo(() => {
    if (!start || !serverPlan || stops.length < 2) return null;
    const sequence = sequenceOf(stops);
    if (serverPlan.legSeconds.length !== sequence.length - 1) return null;
    return JSON.stringify(
      reviewRequestBody(
        sequence.map((p) => p.label),
        serverPlan.legSeconds,
        endSame,
        lockCount,
        stops.length,
        serverPlan.exact,
        locale,
      ),
    );
  }, [sequenceOf, serverPlan, start, stops, endSame, lockCount, locale]);
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

  // A IA só vê os nomes, não o mapa: antes de oferecer "Aceitar sugestão", a ordem
  // sugerida é calculada com os mesmos tempos reais (tudo travado nela) e só vale
  // se for mais rápida que a atual.
  const suggestedStops = aiOutcome?.review?.suggestedStops ?? null;
  const suggestionLocks = useMemo(
    () => (suggestedStops ? locksFromSuggestion(stops.map((s) => s.id), suggestedStops) : null),
    [suggestedStops, stops],
  );
  const checkBody = useMemo(
    () =>
      suggestionLocks && start
        ? JSON.stringify(
            planRequestBody({ start, stops: typedStops, end, endSame, locks: suggestionLocks, mode: timeMode, dateTime }),
          )
        : null,
    [suggestionLocks, start, typedStops, end, endSame, timeMode, dateTime],
  );
  const [suggestionCheck, setSuggestionCheck] = useState<{ body: string; outcome: PlanOutcome } | null>(null);
  useEffect(() => {
    if (!checkBody) return;
    const controller = new AbortController();
    void fetchPlan(checkBody, controller.signal).then((result) => {
      if (!controller.signal.aborted) setSuggestionCheck({ body: checkBody, outcome: result });
    });
    return () => controller.abort();
  }, [checkBody]);
  const checked = checkBody && suggestionCheck?.body === checkBody ? suggestionCheck.outcome : null;
  const verdict =
    checked?.kind === "ok" && serverPlan ? judgeSuggestion(serverPlan.totalSeconds, checked.plan.totalSeconds) : null;

  // Aviso de rota impossível (ex.: locais separados pelo mar).
  const noRouteMessage = (() => {
    if (outcome?.kind !== "no-route") return null;
    const all = [start, ...typedStops, end].filter((p): p is Place => p !== null);
    const from = all.find((p) => p.id === outcome.fromId);
    const to = all.find((p) => p.id === outcome.toId);
    return t.stops.noRoute(from && to ? from.label : null, from && to ? to.label : null);
  })();

  // Colunas de blocos grudadas nas bordas (desktop): os controles do mapa ficam ao lado delas.
  const blockWidthPx = BLOCK_WIDTH_REM * fontPx;
  const layoutBlocks = settings.layout;
  const columnInsets = useMemo(
    () => ({
      left: isDesktop && layoutBlocks.left.length > 0 ? blockWidthPx + EDGE_MARGIN : 0,
      right: isDesktop && layoutBlocks.right.length > 0 ? blockWidthPx + EDGE_MARGIN : 0,
    }),
    [isDesktop, layoutBlocks.left.length, layoutBlocks.right.length, blockWidthPx],
  );

  // Textos de resumo. O total inclui a permanência nas paradas.
  const totalText = plan ? formatDuration(plan.totalSeconds) : "—";
  const arriveText = plan ? formatTimeWithDay(plan.arriveAt, plan.departAt) : "—";
  const tripLeg = tripView?.plan?.legs[0];
  const handleSummary = !start
    ? t.empty.handle
    : trip && target && tripLeg
      ? `${t.trip.next}: ${target.label} · ${formatTime(tripLeg.arriveAt)}`
      : `${totalText} · ${t.common.stops(stops.length)} · ${t.summary.arrivesAt(arriveText)}`;
  const distanceText = totalDistance ? `${totalDistance.estimated ? "≈ " : ""}${formatKm(totalDistance.meters)}` : "—";

  // Painel da viagem, no Resumo.
  const tripPanel = (() => {
    const buttonBase =
      "focus-ring flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-compact font-semibold transition-colors duration-150 motion-reduce:transition-none";
    const primary = `${buttonBase} bg-accent text-white hover:bg-accent/90 dark:text-[#10131c]`;
    const secondary = `${buttonBase} border border-line-strong text-ink-2 hover:bg-hover hover:text-ink`;
    if (!trip) {
      return (
        <button
          type="button"
          onClick={() => setTripWarning(true)}
          disabled={!plan || !target}
          className={`${primary} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <PlayIcon />
          {t.trip.start}
        </button>
      );
    }
    const arrivedPlace = trip.arrivedId ? stops.find((s) => s.id === trip.arrivedId) : undefined;
    const title =
      trip.status === "running"
        ? t.trip.running
        : trip.status === "paused"
          ? t.trip.paused
          : trip.status === "arrived"
            ? t.trip.arrived(arrivedPlace?.label ?? t.stops.fallbackName)
            : t.trip.finished;
    const firstStreet = tripView?.server.streetLegs?.slice(0, 1);
    const legMeters =
      tripView && tripView.sequence.length > 1
        ? routeMeters(tripView.sequence.slice(0, 2), firstStreet)
        : null;
    return (
      <div className="flex flex-col gap-2.5 rounded-lg border border-accent/35 bg-accent/5 p-3" aria-live="polite">
        <p className="flex items-center gap-2 text-xs font-semibold text-ink">
          {trip.status === "finished" ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              <FlagIcon />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                trip.status === "running"
                  ? "animate-pulse bg-emerald-500 motion-reduce:animate-none"
                  : trip.status === "arrived"
                    ? "bg-accent"
                    : "bg-amber-500"
              }`}
            />
          )}
          {title}
        </p>
        {(trip.status === "running" || trip.status === "paused") && target && (
          <div className="flex flex-col gap-0.5">
            <p className="truncate text-compact text-ink">
              <span className="text-muted">{t.trip.next}:</span> <span className="font-medium">{target.label}</span>
            </p>
            <p className="text-xs text-muted">
              {tripLeg && legMeters
                ? t.trip.eta(
                    formatTime(tripLeg.arriveAt),
                    formatDuration(tripLeg.seconds),
                    `${legMeters.estimated ? "≈ " : ""}${formatKm(legMeters.meters)}`,
                  )
                : fix
                  ? t.trip.updating
                  : t.trip.waitingGps}
            </p>
            {tripView?.plan && tripView.sequence.length > 2 && (
              <p className="text-xs text-muted">
                {t.trip.endEta(formatTimeWithDay(tripView.plan.arriveAt, tripView.plan.departAt))}
              </p>
            )}
          </div>
        )}
        {trip.status === "arrived" && <p className="text-xs text-muted">{t.trip.arrivedHint}</p>}
        <div className="flex flex-wrap gap-2">
          {trip.status === "running" && (
            <button type="button" onClick={() => setTrip({ status: "paused" })} className={`${secondary} flex-1`}>
              <PauseIcon />
              {t.trip.pause}
            </button>
          )}
          {(trip.status === "paused" || trip.status === "arrived") && (
            <button type="button" onClick={resumeTrip} className={`${primary} flex-1`}>
              <PlayIcon />
              {t.trip.resume}
            </button>
          )}
          {trip.status === "finished" ? (
            <button type="button" onClick={endTrip} className={`${secondary} flex-1`}>
              {t.trip.close}
            </button>
          ) : (
            <button type="button" onClick={endTrip} className={secondary} aria-label={t.trip.end} title={t.trip.end}>
              <StopIcon />
              {t.trip.end}
            </button>
          )}
        </div>
      </div>
    );
  })();

  const tourSteps: TourStep[] = [
    { target: "#bloco-inicio", text: t.tour.start },
    { target: "#bloco-paradas", text: t.tour.stops },
    { target: "#bloco-resumo", text: t.tour.summary },
    { target: "#bloco-acoes", text: t.tour.actions },
    { target: ".rotas-ctrl-button", text: t.tour.settings, prefer: ["left", "bottom"] },
  ];
  const startEndSummary = !start
    ? t.empty.startSummary
    : endSame
      ? t.startEnd.roundTrip(start.label)
      : end
        ? t.startEnd.toEnd(start.label, end.label)
        : t.startEnd.endsAtLastStop(start.label);
  const dwellTotal = plan?.dwellSeconds ?? 0;
  // A ordem só muda o tempo dirigindo; a permanência é a mesma em qualquer ordem.
  const savedMinutes = plan ? Math.round((typedSeconds - plan.driveSeconds) / 60) : 0;
  const dateValue = dateTime ?? (anchor ? toLocalInputValue(anchor) : "");

  // Blocos do HUD. Onde cada um aparece vem das configurações (arrastar e soltar).
  const blocks: Record<BlockId, (options: BlockOptions) => ReactNode> = {
    inicio: (options) => (
          <CollapsibleCard
            id="bloco-inicio"
            title={t.blocks.start}
            summary={startEndSummary}
            open={isOpen("inicio")}
            onToggle={() => toggle("inicio")}
            {...options}
          >
            <div className="flex flex-col gap-3">
              <PlaceField
                label={t.startEnd.start}
                value={start?.label ?? ""}
                placeholder={t.startEnd.placeholder}
                onSubmit={(text) => submitFixed(text, "start")}
                suggest={suggestAddresses}
                onPick={(s) => setFixed("start", placeFromSuggestion(s))}
                trailing={gpsButton("start")}
              />

              <div className="flex items-center justify-between gap-3">
                <span id={switchId} className="text-sm text-ink-2">
                  {t.startEnd.sameEnd}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={endSame}
                  aria-labelledby={switchId}
                  onClick={() => setRoute((prev) => ({ ...prev, endSame: !prev.endSame }))}
                  className={`focus-ring relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none ${
                    endSame ? "bg-accent" : "bg-line-strong"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-200 motion-reduce:transition-none ${
                      endSame ? "translate-x-4" : ""
                    }`}
                  />
                </button>
              </div>

              {/* O campo Fim só aparece com o switch desligado. */}
              {!endSame && (
                <PlaceField
                  label={t.startEnd.end}
                  value={end?.label ?? ""}
                  placeholder={t.startEnd.endPlaceholder}
                  onSubmit={(text) => submitFixed(text, "end")}
                  suggest={suggestAddresses}
                  onPick={(s) => setFixed("end", placeFromSuggestion(s))}
                  trailing={gpsButton("end")}
                />
              )}

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-ink-2">
                  {t.startEnd.schedule}
                </legend>
                <div className="mb-2 grid grid-cols-2 gap-0.5 rounded-lg bg-sunken p-0.5">
                  {(
                    [
                      ["depart", t.startEnd.depart],
                      ["arrive", t.startEnd.arrive],
                    ] as const
                  ).map(([mode, text]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={timeMode === mode}
                      onClick={() => setRoute((prev) => ({ ...prev, timeMode: mode }))}
                      className={`focus-ring rounded-md px-2 py-1.5 text-compact font-medium transition-colors duration-150 motion-reduce:transition-none ${
                        timeMode === mode
                          ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
                          : "text-muted hover:text-ink"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <label htmlFor={dateId} className="sr-only">
                    {t.startEnd.dateTime}
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
                    className="focus-ring shrink-0 rounded-lg border border-line px-3 text-compact font-medium text-ink-2 transition-colors hover:bg-hover disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
                  >
                    {t.startEnd.now}
                  </button>
                </div>
              </fieldset>
            </div>
          </CollapsibleCard>
    ),
    paradas: (options) => (
          <CollapsibleCard
            id="bloco-paradas"
            title={t.blocks.stops(stops.length, MAX_STOPS)}
            summary={t.common.stops(stops.length)}
            open={isOpen("paradas")}
            onToggle={() => toggle("paradas")}
            {...options}
          >
            <div className="flex flex-col gap-3">
              {stops.length === 0 ? (
                <p className="text-sm text-muted">
                  {t.stops.empty}
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted">
                    {t.stops.hint}
                  </p>
                  <StopList
                    stops={stops}
                    legs={plan?.legs}
                    locks={locks}
                    showLegColors={streetLegs !== null}
                    onMove={handleMove}
                    onToggleLock={handleToggleLock}
                    onRemove={removeStop}
                    onDwellChange={setDwell}
                    doneIds={doneIds}
                    onToggleDone={toggleDone}
                  />
                </>
              )}

              {noRouteMessage && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                  {noRouteMessage}
                </p>
              )}

              {isApproximate(stops.length) && (
                <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {t.stops.approximate}
                </p>
              )}

              <PlaceField
                label={t.stops.add}
                value=""
                placeholder={t.startEnd.placeholder}
                addMode
                onSubmit={submitStop}
                suggest={suggestAddresses}
                onPick={(s) => tryAddStop(placeFromSuggestion(s))}
              />
            </div>
          </CollapsibleCard>
    ),
    acoes: (options) => (
          <CollapsibleCard
            id="bloco-acoes"
            title={t.blocks.actions}
            summary={t.blocks.actionsSummary}
            open={isOpen("acoes")}
            onToggle={() => toggle("acoes")}
            {...options}
          >
            {!start ? (
              <p className="text-sm text-muted">{t.empty.actions}</p>
            ) : (
            <ActionsPanel
              start={start}
              stops={stops}
              doneIds={doneIds}
              finalPlace={finalPlace}
              roundTrip={endSame}
              plan={plan}
              isMobile={!isDesktop}
              onNotify={notify}
            />
            )}
          </CollapsibleCard>
    ),
    resumo: (options) => (
          <CollapsibleCard
            id="bloco-resumo"
            title={t.blocks.summary}
            summary={start ? `${totalText} · ${t.summary.arrivesAt(arriveText)}` : t.empty.handle}
            open={isOpen("resumo")}
            onToggle={() => toggle("resumo")}
            {...options}
          >
            {!start ? (
              <p className="text-sm text-muted">{t.empty.summary}</p>
            ) : (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-display font-semibold leading-none tracking-[-0.02em] text-ink">{totalText}</p>
                  <p className="mt-1.5 text-xs text-muted">
                    {endSame ? t.summary.totalRoundTrip : t.summary.total}
                    {plan && dwellTotal > 0 && (
                      <>
                        {": "}
                        {t.summary.split(formatDuration(plan.driveSeconds), formatDuration(dwellTotal))}
                      </>
                    )}
                  </p>
                </div>
                {savedMinutes > 0 && (
                  <span className="mb-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    −{savedMinutes} min
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line">
                <div className="px-3 py-2">
                  <dt className="text-2xs font-medium text-muted">{t.summary.departure}</dt>
                  <dd className="text-md font-semibold text-ink">{plan ? formatTime(plan.departAt) : "—"}</dd>
                </div>
                <div className="border-l border-line px-3 py-2">
                  <dt className="text-2xs font-medium text-muted">{t.summary.arrival}</dt>
                  <dd className="text-md font-semibold text-ink">{arriveText}</dd>
                </div>
                <div className="col-span-2 border-t border-line px-3 py-2">
                  <dt className="text-2xs font-medium text-muted">{t.summary.distance}</dt>
                  <dd className="text-md font-semibold text-ink">{distanceText}</dd>
                </div>
              </dl>

              {tripPanel}

              <div className="flex items-start justify-between gap-2">
                <p className="text-compact text-ink-2">
                  {t.summary.typed(formatDuration(typedSeconds + dwellTotal))}{" "}
                  {savedMinutes > 0 ? (
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      {t.summary.saved(savedMinutes)}
                    </span>
                  ) : (
                    t.summary.notFaster
                  )}
                </p>
                <InfoTip label={t.summary.moreInfo}>
                  <ul className="flex flex-col gap-1">
                    <li>
                      {t.summary.source}:{" "}
                      {planStatus === "ok" && serverPlan
                        ? (t.summary.sourceNames[serverPlan.source.name] ?? serverPlan.source.label)
                        : planStatus === "no-route"
                          ? t.summary.sourceNoRoute
                          : planStatus === "loading"
                            ? t.summary.sourceLoading
                            : t.summary.sourceFailed}
                      .
                    </li>
                    <li>
                      {t.summary.order}: {orderExact ? t.summary.exact : t.summary.approximate}
                      {lockCount > 0 ? t.summary.respectingLocks : orderExact ? t.summary.best : ""}.
                    </li>
                    {serverPlan?.checkedSeconds != null && (
                      <li>{t.summary.streets(formatDuration(serverPlan.checkedSeconds))}</li>
                    )}
                  </ul>
                </InfoTip>
              </div>

              {lockCount > 0 && plan && (
                <p className="text-compact text-ink-2">
                  {t.summary.locked(lockCount)}{" "}
                  {plan.driveSeconds - bestSeconds >= 60 ? (
                    <span className="font-medium text-amber-800 dark:text-amber-300">
                      {t.summary.withoutLocks(formatDuration(bestSeconds + dwellTotal), Math.round((plan.driveSeconds - bestSeconds) / 60))}
                    </span>
                  ) : (
                    t.summary.stillFastest
                  )}
                </p>
              )}

              {serverPlan?.arrival && !serverPlan.arrival.converged && (
                <p className="text-xs text-muted">{t.summary.unstable}</p>
              )}

              <div className="flex flex-col gap-1.5 border-t border-line pt-3" aria-live="polite">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>
                    {(aiTier !== "local" || aiLoading) && <Sparkles />}
                    {aiLoading
                      ? t.ai.loading
                      : aiOutcome?.review
                        ? t.ai.comment
                        : stops.length < 2
                          ? t.ai.localOnly
                          : t.ai.noAi}
                  </Badge>
                </p>
                {aiOutcome?.review && (
                  <>
                    <p className="text-compact leading-relaxed text-ink-2">{aiOutcome.review.explanation}</p>
                    {/* Só a sugestão com ordem é conferível; ela aparece depois de passar pelos tempos reais. */}
                    {suggestedStops && !checked && (
                      <p className="text-xs text-muted">{t.ai.checking}</p>
                    )}
                    {suggestedStops && verdict?.faster && (
                      <>
                        {aiOutcome.review.backtracking && (
                          <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            {t.ai.backtracking}
                          </p>
                        )}
                        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                          <p className="text-xs leading-relaxed text-ink-2">
                            <span className="font-semibold text-ink">{t.ai.suggestion}</span> {aiOutcome.review.suggestion}
                          </p>
                          <p className="text-2xs text-muted">
                            {t.ai.newOrder} {suggestedStops.map((from) => stops[from]?.label).join(" → ")}
                          </p>
                          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            {t.ai.faster(formatDuration(-verdict.diffSeconds))}
                          </p>
                          <button
                            type="button"
                            onClick={() => acceptSuggestion(suggestedStops)}
                            className="focus-ring self-start rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-on-ink hover:bg-ink/85"
                          >
                            {t.ai.accept}
                          </button>
                        </div>
                      </>
                    )}
                    {suggestedStops && verdict && !verdict.faster && (
                      <p className="text-xs text-muted">
                        {t.ai.slower(verdict.diffSeconds >= 60 ? formatDuration(verdict.diffSeconds) : null)}
                      </p>
                    )}
                    {suggestedStops && checked && checked.kind !== "ok" && (
                      <p className="text-xs text-muted">
                        {t.ai.uncheckable}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
            )}
          </CollapsibleCard>
    ),
  };

  // ---------- Posição dos blocos no desktop ----------
  const drag = blockDrag.drag;
  const viewport = typeof window === "undefined" ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight };
  const cardOptions = (id: BlockId, extra: Partial<BlockOptions> = {}): BlockOptions => ({
    variant: "card",
    headerDrag: blockDrag.headerDrag(id),
    blockRef: blockDrag.register(id),
    className: `w-[23rem] ${extra.className ?? ""}`,
    ...(extra.style ? { style: extra.style } : {}),
    ...(extra.collapseTo ? { collapseTo: extra.collapseTo } : {}),
  });
  /** Lugar reservado na coluna enquanto um bloco é arrastado para ela (o "ímã"). */
  const placeholder = drag && (
    <div
      key="lugar"
      aria-hidden="true"
      className="w-[23rem] shrink-0 rounded-xl border-2 border-dashed border-accent/60 bg-accent/5"
      style={{ height: Math.min(drag.rect.height, 160) }}
    />
  );
  const column = (side: "left" | "right") => {
    const ids = layoutBlocks[side].filter((id) => id !== drag?.id);
    const items: ReactNode[] = ids.map((id) => (
      <Fragment key={id}>{blocks[id](cardOptions(id, { className: "shrink-0" }))}</Fragment>
    ));
    if (drag?.target.kind === "dock" && drag.target.side === side) {
      items.splice(Math.min(drag.target.index, items.length), 0, placeholder);
    }
    if (items.length === 0) return null;
    return (
      <div
        key={side}
        className="pointer-events-none fixed top-4 z-10 flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto [scrollbar-width:none]"
        style={{ [side]: EDGE_MARGIN }}
      >
        {items}
      </div>
    );
  };
  const freeBlocks = BLOCK_IDS.filter((id) => layoutBlocks.free[id] && id !== drag?.id).map((id) => {
    const position = layoutBlocks.free[id]!;
    return (
      <Fragment key={id}>
        {blocks[id](
          cardOptions(id, {
            className: "fixed z-10",
            style: freeStyle(position),
            // Preso pela base, o bloco recolhe para baixo.
            collapseTo: position.v === "bottom" ? "down" : "up",
          }),
        )}
      </Fragment>
    );
  });
  /** O bloco sendo arrastado: segue o ponteiro, ou já gruda na margem quando o ímã pega. */
  const draggedBlock = (() => {
    if (!drag) return null;
    const rect =
      drag.target.kind === "free"
        ? freeRect(drag.target.position, drag.rect, viewport)
        : drag.rect;
    return blocks[drag.id](
      cardOptions(drag.id, {
        className: "fixed z-30 ring-2 ring-accent/40 shadow-[0_16px_40px_rgb(0_0_0/0.25)] transition-[left,top] duration-75",
        style: { left: rect.left, top: rect.top },
        collapseTo: drag.target.kind === "free" && drag.target.position.v === "bottom" ? "down" : "up",
      }),
    );
  })();

  return (
    <I18nProvider locale={locale}>
    <main className="relative h-dvh w-full overflow-hidden">
      <h1 className="sr-only">{t.app.title}</h1>

      <MapView
        points={points}
        path={mapPath}
        streetLegs={mapStreetLegs}
        onLegClick={handleLegClick}
        selectedLeg={info?.leg ?? null}
        doneLegs={tripView ? [] : doneLegs}
        legColors={view.colors}
        me={trip && fix ? fix : null}
        follow={tripRunning}
        columnInsets={columnInsets}
        fitVersion={fitVersion}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
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
                : infoPlace.id === start?.id
                  ? t.popup.roleStart
                  : infoIsStop
                    ? t.popup.roleStop(stops.findIndex((s) => s.id === infoPlace.id) + 1)
                    : t.popup.roleEnd
            }
            address={info.address}
            lat={info.lat}
            lng={info.lng}
            onCopy={() => {
              const text = `${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}`;
              void navigator.clipboard?.writeText(text).then(
                () => notify(t.popup.coordsCopied),
                () => notify(t.common.copyFailed),
              );
            }}
            actions={
              infoPlace
                ? []
                : [
                    {
                      badge: String(Math.min(stops.length + 1, MAX_STOPS)),
                      title: t.popup.addStop,
                      description:
                        stops.length >= MAX_STOPS
                          ? t.popup.limitReached(MAX_STOPS)
                          : t.popup.addStopDesc,
                      primary: true,
                      disabled: stops.length >= MAX_STOPS,
                      onClick: () => {
                        const place = placeFromInfo(info);
                        const problem = tryAddStop(place);
                        if (problem) notify(problem);
                        else {
                          notify(t.stops.added, place.id);
                          setInfo(null);
                        }
                      },
                    },
                    {
                      badge: "A",
                      title: t.popup.setStart,
                      description: start ? t.popup.replaces(start.label) : t.popup.startDesc,
                      onClick: () => {
                        const problem = setFixed("start", placeFromInfo(info));
                        if (problem) notify(problem);
                        else setInfo(null);
                      },
                    },
                    {
                      badge: "B",
                      title: t.popup.setEnd,
                      description:
                        !endSame && end ? t.popup.replaces(end.label) : t.popup.endDesc,
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
                  className="focus-ring self-start rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                  onClick={() => {
                    removeStop(infoPlace.id);
                    setInfo(null);
                  }}
                >
                  {t.popup.removeStop}
                </button>
              ) : undefined
            }
          />
        )}
      </MapView>

      {isDesktop ? (
        // Desktop: cada bloco é um cartão sobre o mapa, arrastável pelo título.
        <aside aria-label={t.app.panel}>
          {column("left")}
          {column("right")}
          {freeBlocks}
          {draggedBlock}
        </aside>
      ) : (
      <aside
        aria-label={t.app.panel}
        className="fixed inset-x-0 bottom-0 z-10 flex max-h-[62dvh] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface shadow-sheet"
      >
        <button
          type="button"
          aria-expanded={sheetOpen}
          aria-controls="hud-conteudo"
          onClick={() => setSheetOpen((open) => !open)}
          className="focus-ring flex w-full shrink-0 flex-col items-center gap-2 px-4 pb-3 pt-2 outline-offset-[-2px]"
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-line-strong" />
          <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold text-ink">
            <span className="truncate">{handleSummary}</span>
            <span className="rotate-180 text-faint">
              <Chevron open={sheetOpen} />
            </span>
          </span>
          <span className="sr-only">{sheetOpen ? t.app.closePanel : t.app.openPanel}</span>
        </button>

        <div
          id="hud-conteudo"
          inert={!sheetOpen}
          className={`grid min-h-0 transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
            sheetOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain border-t border-line">
            {/* No celular, a mesma ordem das colunas do desktop (esquerda, direita, soltos). */}
            {sheetOrder(layoutBlocks, BLOCK_IDS).map((id) => (
              <Fragment key={id}>{blocks[id]({ variant: "section" })}</Fragment>
            ))}
          </div>
        </div>
      </aside>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
        onRestartTutorial={() => {
          setSettingsOpen(false);
          setTourRun((n) => n + 1);
          setTourSeen(false);
        }}
      />

      <TripWarningDialog open={tripWarning} onAccept={beginTrip} onCancel={() => setTripWarning(false)} />

      {!tourSeen && (
        <Tour
          key={tourRun}
          steps={tourSteps}
          onStep={(i) => {
            // No celular os blocos ficam na gaveta: abre para o passo aparecer.
            if (!isDesktop) setSheetOpen(i < tourSteps.length - 1);
          }}
          onClose={() => setTourSeen(true)}
        />
      )}

      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        settings={settings}
        theme={theme}
        onNotify={notify}
      />

      {toast && (
        <div
          key={toast.id}
          role="status"
          className="fixed left-1/2 top-4 z-40 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-3.5 py-2 text-compact text-on-ink shadow-panel md:absolute md:bottom-6 md:top-auto"
        >
          <span>{toast.text}</span>
          {toast.undoStopId && (
            <button
              type="button"
              onClick={() => {
                removeStop(toast.undoStopId!);
                setToast(null);
              }}
              className="focus-ring -my-0.5 rounded px-1.5 py-0.5 font-semibold text-on-ink hover:bg-on-ink/15"
            >
              {t.common.undo}
            </button>
          )}
        </div>
      )}
    </main>
    </I18nProvider>
  );
}
