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
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import ActionsPanel from "./ActionsPanel";
import CollapsibleCard, { Chevron, type HeaderDrag } from "./CollapsibleCard";
import AiBadge from "./AiBadge";
import LeaveStopDialog from "./LeaveStopDialog";
import NewRouteDialog from "./NewRouteDialog";
import { isLocalHost, pointAlong, SIM_INTERVAL_MS, SIM_SPEED_KMH, SIM_SPEEDS_KMH } from "@/lib/trip-sim";
import pkg from "../../package.json";
import { departureReportHtml, finalReportHtml, type ReportConstraints, type ReportRow } from "@/lib/pdf-report";
import { downloadBlob, htmlToPdf } from "@/lib/pdf-file";
import type { TripAnalysis } from "@/lib/report-email";
import { selectClass } from "./DwellPicker";
import MapView, { ROUND_TRIP_BADGE, type MapCapture, type MapLayout, type MapPoint, type MePosition } from "./MapView";
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
import { forgetStoredCopy, useCurrentMinute, useLocalStorageState, useMediaQuery } from "@/lib/hooks";
import {
  fetchParsedPlaces,
  fetchReview,
  judgeSuggestion,
  locksFromSuggestion,
  reviewRequestBody,
  type ReviewOutcome,
} from "@/lib/ai-client";
import { legColor } from "@/lib/leg-colors";
import { haversineMeters } from "@/lib/geo";
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
import { blendedLegTime, placesSignature, rememberPlan, type RememberedPlan } from "@/lib/plan-memory";
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
  hasPassed,
  headingFrom,
  isOffRoute,
  logFix,
  logGo,
  logStop,
  newTripLog,
  remainingRoute,
  routeMeters,
  shouldReplan,
  shouldReroute,
  snapRadius,
  summarizeTrip,
  tripTarget,
  type Fix,
  type TripBaseline,
  type TripLog,
  type TripStatus,
  type TripSummary,
} from "@/lib/trip";
import { projectOnLine, remainingFraction } from "@/lib/route-progress";
import TripStatsDialog from "./TripStatsDialog";
import BreakDialog, { type LegOption } from "./BreakDialog";
import ResumeDialog from "./ResumeDialog";
import {
  breakSecondsByLeg,
  freeLegs,
  legCountOf,
  moveRow,
  normalizeBreaks,
  rowsOf,
  shiftBreaksAfterRemoval,
  type RestBreak,
} from "@/lib/breaks";
import { parseSharedRoute, sharedPath, type SharedItem, type SharedPoint, type SharedRoute } from "@/lib/share-link";
import {
  newTrack,
  trackArrive,
  trackFix,
  trackLeave,
  trackPause,
  trackReroute,
  trackResume,
  tripReportOf,
  type PlannedLeg,
  type TripTrack,
} from "@/lib/trip-track";
import type { TripReport } from "@/lib/trip-report";

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
/** Coluna da direita (início e fim, paradas, abrir e compartilhar): mais larga no computador. */
const RIGHT_BLOCK_WIDTH_REM = 28;

/** Como cada bloco é desenhado: na gaveta do celular, numa coluna ou solto. */
interface BlockOptions {
  variant: "section" | "card";
  collapseTo?: "up" | "down";
  headerDrag?: HeaderDrag;
  blockRef?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  className?: string;
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

/** Rota guardada com algo preenchido, lida direto do localStorage (antes da hidratação). */
function readSavedRoute(): RouteState | null {
  try {
    const raw = window.localStorage.getItem(ROUTE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRouteState(parsed)) return null;
    const route = normalizeRoute(parsed);
    return route.start || route.end || route.stops.length > 0 ? route : null;
  } catch {
    return null;
  }
}

/** Tutorial do primeiro uso: guardado como visto depois de concluir ou pular. */
const TOUR_KEY = "rotas:tutorial:v1";

/** Posição atual como local da rota (início da rota que falta, na viagem). */
/** Até esta distância da parada (depois de chegar), a seta vira a bandeira em cima dela. */
const GOAL_MAGNET_M = 60;
/** Botões do cartão da viagem (topo, no celular). */
const tripCardButton =
  "focus-ring flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-compact font-semibold transition-colors duration-150 motion-reduce:transition-none";
const tripCardPrimary = `${tripCardButton} bg-ink text-on-ink hover:bg-ink/85`;
const tripCardSecondary = `${tripCardButton} border border-line-strong text-ink hover:bg-hover`;
/** Tempo sem mexer na bandeja (celular, carro andando) antes de ela recolher sozinha. */
const SHEET_IDLE_MS = 6_000;

const subscribeNever = () => () => {};
const readLocal = () => isLocalHost(window.location.hostname);

const herePlace = (point: { lat: number; lng: number }, label: string): Place => ({
  id: "gps-aqui",
  label,
  lat: point.lat,
  lng: point.lng,
  source: "pin",
  confidence: 1,
  dwellMinutes: 0,
});

/** Relógio para os eventos da viagem (cliques e leituras do GPS), fora da renderização. */
const nowMs = () => Date.now();

/** Horários de uma sequência já ordenada, com os tempos que o servidor devolveu. */
function planAlong(
  sequence: readonly Place[],
  response: PlanResponse,
  anchor: Date,
  breaks: ReadonlyMap<number, number> = new Map(),
) {
  if (response.legSeconds.length !== sequence.length - 1) return null;
  const known = new Map<string, number>();
  response.legSeconds.forEach((seconds, i) => known.set(`${sequence[i].id}>${sequence[i + 1].id}`, seconds));
  const legTimeFn: LegTimeFn = (from, to) => {
    const seconds = known.get(`${from.id}>${to.id}`);
    return seconds === undefined ? estimateLegTime(from, to) : { seconds, estimated: response.source.estimated };
  };
  return computePlan([...sequence], "depart", anchor, legTimeFn, breaks);
}

/** Xícara: pausa para descanso. */
function CupIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h9v4a4 4 0 01-4 4H8a4 4 0 01-4-4z" />
      <path d="M13 9h1.5a2 2 0 010 4H13" />
      <path d="M7 3.5c0 1 1 1 1 2M10 3.5c0 1 1 1 1 2" />
    </svg>
  );
}

interface Toast {
  id: number;
  text: string;
  /** Parada que o botão "Desfazer" remove. */
  undoStopId?: string;
  /** Desfazer uma ação qualquer (ex.: a rota aberta por um link). */
  undo?: () => void;
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
    document.title = t.app.title;
  }, [locale, t.app.title]);
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
  /** Data e hora escolhidas (guardadas com a rota); null = "agora", acompanhando o relógio. */
  const dateTime = route.dateTime ?? null;
  const setDateTime = (value: string | null) => setRoute((prev) => ({ ...prev, dateTime: value }));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  /** Área visível do mapa, usada como viés na busca por endereço. */
  const bboxRef = useRef<BBoxTuple | null>(null);

  const [openBlocks, setOpenBlocks] = useLocalStorageState(BLOCKS_KEY, BLOCKS_DEFAULT);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  /** Celular e tablet: cabeçalho da viagem, mapa girando sozinho e botões maiores. */
  const isCompact = useMediaQuery("(max-width: 1023px), (pointer: coarse)");
  const currentMinute = useCurrentMinute();
  const switchId = useId();
  const dateId = useId();

  // "Abrir e compartilhar" sempre começa recolhido: o estado dele não é guardado.
  const [actionsOpen, setActionsOpen] = useState(false);
  const isOpen = (id: BlockId) => (id === "acoes" ? actionsOpen : (openBlocks[id] ?? BLOCKS_DEFAULT[id]));
  const toggle = (id: BlockId) => {
    const opening = !isOpen(id);
    // Celular, fora da viagem: ao abrir um bloco, os outros se fecham (poupa espaço na gaveta).
    const accordion = !isDesktop && trip === null && opening;
    if (accordion) {
      setActionsOpen(id === "acoes");
      setOpenBlocks({
        ...BLOCKS_DEFAULT,
        ...openBlocks,
        inicio: id === "inicio",
        paradas: id === "paradas",
        resumo: id === "resumo",
      });
      return;
    }
    if (id === "acoes") setActionsOpen((open) => !open);
    else setOpenBlocks({ ...BLOCKS_DEFAULT, ...openBlocks, [id]: opening });
  };

  // O aviso some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notifyUndo = (text: string, undo: () => void) =>
    setToast((previous) => ({ id: (previous?.id ?? 0) + 1, text, undo }));
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
  /** Chegada obrigatória numa parada com a saída fixa (a posição da parada é calculada). */
  const fixedDeadline =
    route.arriveMode === "fixed" && route.arriveAtStop && route.arriveAtTime && timeMode === "depart"
      ? { stopId: route.arriveAtStop, at: route.arriveAtTime }
      : null;
  const requestBody = useMemo(
    () =>
      start
        ? JSON.stringify(
            planRequestBody({
              start,
              stops: typedStops,
              end,
              endSame,
              locks,
              mode: timeMode,
              dateTime,
              deadline: fixedDeadline,
              avoidTolls: settings.avoidTolls,
            }),
          )
        : null,
    [start, typedStops, end, endSame, locks, timeMode, dateTime, fixedDeadline, settings.avoidTolls],
  );
  const [remote, setRemote] = useState<{ body: string; outcome: PlanOutcome } | null>(null);
  /** Último cálculo bom do servidor: cobre o intervalo até a próxima resposta (e falhas). */
  const [lastOk, setLastOk] = useState<RememberedPlan | null>(null);
  const requestSignature = useMemo(() => (requestBody ? placesSignature(requestBody) : null), [requestBody]);

  useEffect(() => {
    if (!requestBody) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchPlan(requestBody, controller.signal).then((outcome) => {
        if (controller.signal.aborted) return;
        setRemote({ body: requestBody, outcome });
        if (outcome.kind === "ok") setLastOk(rememberPlan(requestBody, outcome.plan));
      });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestBody]);

  /** Resposta do servidor para a rota atual; null enquanto calcula ou se falhou. */
  const outcome = requestBody && remote?.body === requestBody ? remote.outcome : null;
  // Mudou só a trava, o horário ou a permanência (os mesmos locais)? Até a resposta nova chegar,
  // vale o último cálculo do servidor, em vez de pular para a estimativa em linha reta.
  const staleServerPlan =
    !outcome && lastOk && requestSignature !== null && lastOk.signature === requestSignature ? lastOk.plan : null;
  const serverPlan: PlanResponse | null = outcome?.kind === "ok" ? outcome.plan : staleServerPlan;
  const planStatus: "loading" | "ok" | "failed" | "no-route" =
    !outcome ? "loading" : outcome.kind === "ok" ? "ok" : outcome.kind;

  // Sem resposta do servidor para estes locais (ou se falhar), vale a estimativa local: os pares que o
  // servidor já calculou entram com o tempo certo e só o que é novo é estimado por distância.
  const knownLegTime = useMemo(() => blendedLegTime(lastOk), [lastOk]);
  const local = useMemo(() => {
    if (!start) return { stops: [...typedStops], seconds: 0, typedSeconds: 0, exact: true, bestSeconds: 0 };
    const constrained = optimizeStops(start, typedStops, finalPlace, knownLegTime, undefined, locks);
    // Com travas, a melhor ordem livre fica só para comparação.
    const bestSeconds =
      lockCount > 0
        ? optimizeStops(start, typedStops, finalPlace, knownLegTime).seconds
        : constrained.seconds;
    return { ...constrained, bestSeconds };
  }, [start, typedStops, finalPlace, locks, lockCount, knownLegTime]);

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
    if (!serverPlan) return knownLegTime;
    const sequence = sequenceOf(stops);
    const known = new Map<string, number>();
    serverPlan.legSeconds.forEach((seconds, i) => {
      if (sequence[i + 1]) known.set(`${sequence[i].id}>${sequence[i + 1].id}`, seconds);
    });
    return (from, to) => {
      const seconds = known.get(`${from.id}>${to.id}`);
      return seconds === undefined
        ? knownLegTime(from, to)
        : { seconds, estimated: serverPlan.source.estimated };
    };
  }, [sequenceOf, serverPlan, stops, knownLegTime]);

  const typedSeconds = serverPlan?.typedSeconds ?? local.typedSeconds;
  const orderExact = serverPlan?.exact ?? local.exact;
  const bestSeconds = serverPlan?.bestSeconds ?? local.bestSeconds;

  const anchor = useMemo(() => {
    if (dateTime) return new Date(dateTime);
    return currentMinute === null ? null : new Date(currentMinute * 60_000);
  }, [dateTime, currentMinute]);

  /** Pausas para descanso válidas para a rota atual (uma por trecho, travadas). */
  const legCount = legCountOf(typedStops.length, finalPlace !== null);
  const breaks = useMemo(
    () => normalizeBreaks(route.breaks ?? [], typedStops.length, finalPlace !== null),
    [route.breaks, typedStops.length, finalPlace],
  );
  const breakMap = useMemo(() => breakSecondsByLeg(breaks), [breaks]);

  /** "Chegar até" numa parada específica: o trecho que chega nela (o i-ésimo trecho chega na parada i). */
  const arriveIndex = route.arriveAtStop ? stops.findIndex((s) => s.id === route.arriveAtStop) : -1;
  const arriveLeg = timeMode === "arrive" && route.arriveMode !== "fixed" && arriveIndex !== -1 ? arriveIndex : null;
  /** Chegada obrigatória com saída fixa: o trecho que chega na parada espera até a hora, se chegar antes. */
  const holdAtMs = fixedDeadline && arriveIndex !== -1 ? new Date(fixedDeadline.at).getTime() : null;

  const plan = useMemo(() => {
    // Sem início ainda não há rota; sem caminho de carro, não há tempos para mostrar.
    if (!start || planStatus === "no-route") return null;
    if (!anchor || Number.isNaN(anchor.getTime())) return null;
    const sequence = sequenceOf(stops);
    const hold = holdAtMs !== null && !Number.isNaN(holdAtMs) ? { leg: arriveIndex, at: new Date(holdAtMs) } : null;
    return computePlan(sequence, timeMode, anchor, legTime, breakMap, arriveLeg, hold);
  }, [sequenceOf, anchor, start, stops, timeMode, legTime, planStatus, breakMap, arriveLeg, holdAtMs, arriveIndex]);

  /** Distância total da rota: pelas ruas, quando o provedor devolve; senão, estimada. */
  const totalDistance = useMemo(
    () => (start ? routeMeters(sequenceOf(stops), serverPlan?.streetLegs) : null),
    [start, sequenceOf, stops, serverPlan],
  );

  /** Viagem em andamento (lida nas ações, para a parada nova entrar travada no fim). */
  const tripActiveRef = useRef(false);

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
      // Em viagem, a parada nova vai para depois da última (travada ali); para outro lugar,
      // arraste-a na lista: ela fica travada onde for solta e o resto é recalculado.
      const locks = tripActiveRef.current ? { ...(prev.locks ?? {}), [place.id]: prev.stops.length } : prev.locks;
      return { ...prev, stops: result.stops, locks };
    });
    return problem;
  };

  const displayedIds = stops.map((s) => s.id);

  const removeStop = (id: string) => {
    const position = displayedIds.indexOf(id);
    setRoute((prev) => ({
      ...prev,
      stops: prev.stops.filter((s) => s.id !== id),
      locks: removeFromLocks(displayedIds, locks, id),
      // As pausas depois da parada removida sobem um trecho (continuam no mesmo lugar da rota).
      breaks: position === -1 ? prev.breaks : shiftBreaksAfterRemoval(breaks, position),
    }));
  };

  /**
   * Arrastar e soltar uma linha da lista (parada ou pausa). A parada solta fica
   * travada naquela posição; a pausa muda de trecho. Duas pausas juntas não valem.
   */
  const handleMoveRow = (from: number, to: number) => {
    const result = moveRow(rowsOf(stops, breaks), from, to, legCount);
    if (!result.ok) {
      notify(result.reason === "adjacent" ? t.breaks.adjacent : t.breaks.edge);
      return;
    }
    const nextLocks = result.stopMove
      ? moveStop(displayedIds, locks, result.stopMove.from, result.stopMove.to).locks
      : locks;
    setRoute((prev) => ({ ...prev, locks: nextLocks, breaks: result.breaks }));
  };

  /** Pergunta "continuar ou começar do zero" (o texto é o resumo do que está guardado). */
  const [resumeAsk, setResumeAsk] = useState<string | null>(null);
  /** Começar do zero: apaga tudo deste app no navegador, menos as configurações. */
  const startFresh = () => {
    try {
      const keep = new Set([SETTINGS_KEY, TOUR_KEY, "rotas:relatorio:enviado"]);
      const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i));
      for (const key of keys) if (key?.startsWith("rotas:") && !keep.has(key)) window.localStorage.removeItem(key);
    } catch {
      // Sem acesso ao localStorage: não há o que apagar.
    }
    window.location.reload();
  };

  // ---------- Pausas para descanso ----------
  const [breakDialog, setBreakDialog] = useState(false);
  const legName = (i: number) => {
    const from = i === 0 ? t.breaks.startName : `${i}. ${stops[i - 1]?.label ?? ""}`;
    const to = i < stops.length ? `${i + 1}. ${stops[i].label}` : endSame ? t.breaks.backName : t.breaks.endName;
    return t.breaks.leg(from, to);
  };
  const breakOptions: LegOption[] = Array.from({ length: legCount }, (_, i) => ({
    value: i,
    label: legName(i),
    disabled: !freeLegs(breaks, legCount).includes(i),
  }));
  const addBreak = (minutes: number, after: number) => {
    const brk: RestBreak = { id: crypto.randomUUID(), minutes, after };
    setRoute((prev) => ({ ...prev, breaks: [...breaks, brk] }));
    notify(t.breaks.added);
  };
  const setBreakMinutes = (id: string, minutes: number) =>
    setRoute((prev) => ({
      ...prev,
      breaks: breaks.map((b) => (b.id === id ? { ...b, minutes: Math.max(1, Math.min(Math.round(minutes), MAX_DWELL_MINUTES)) } : b)),
    }));
  const removeBreak = (id: string) => setRoute((prev) => ({ ...prev, breaks: breaks.filter((b) => b.id !== id) }));

  // ---------- Link compartilhável ----------
  const shareRoute = useMemo<SharedRoute | null>(() => {
    if (!start) return null;
    const point = (p: Place): SharedPoint => ({ lat: p.lat, lng: p.lng, dwellMinutes: 0 });
    const items: SharedItem[] = rowsOf(stops, breaks).map((row) =>
      row.kind === "stop"
        ? {
            kind: "stop",
            lat: row.stop.lat,
            lng: row.stop.lng,
            dwellMinutes: row.stop.dwellMinutes,
            ...(locks[row.stop.id] !== undefined ? { locked: true } : {}),
            ...((timeMode === "arrive" && dateTime) || fixedDeadline
              ? route.arriveAtStop === row.stop.id
                ? { arriveHere: true }
                : {}
              : {}),
          }
        : { kind: "break", minutes: row.brk.minutes },
    );
    // A hora vai junto só quando foi escolhida (sem ela, quem abre usa "agora").
    const time = dateTime ? { mode: timeMode, at: dateTime } : null;
    return {
      start: point(start),
      end: endSame ? "start" : end ? point(end) : "none",
      items,
      time,
      deadline: fixedDeadline?.at ?? null,
    };
  }, [start, end, endSame, stops, breaks, locks, dateTime, timeMode, route.arriveAtStop, fixedDeadline]);
  const sharePath = shareRoute ? sharedPath(shareRoute) : null;

  /** Compartilhar a rota pelo botão do topo (celular): folha do sistema, ou copia o link. */
  const shareRouteLink = async () => {
    if (!sharePath) return;
    const url = `${window.location.origin}${sharePath}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: t.actions.shareTitle, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      notify(t.actions.linkCopied);
    } catch {
      // Fechou a folha de compartilhamento (ou o navegador recusou a cópia): nada a fazer.
    }
  };

  // Abriu por um link (/r/… ou ?s=…): a rota do link entra no lugar da atual,
  // com "Desfazer" para voltar. O endereço é limpo logo em seguida.
  const linkReadRef = useRef(false);
  useEffect(() => {
    if (linkReadRef.current) return;
    linkReadRef.current = true;
    const { pathname, search } = window.location;
    const looksShared = pathname.startsWith("/r/") || new URLSearchParams(search).has("s");
    if (!looksShared) {
      // Abriu normalmente com uma rota guardada: pergunta se continua ou começa do zero.
      const saved = readSavedRoute();
      if (saved) window.setTimeout(() => setResumeAsk(t.common.stops(saved.stops.length)), 0);
      return;
    }
    window.history.replaceState(null, "", "/");
    const shared = parseSharedRoute(pathname, search);
    if (!shared) return;
    const toPlace = (p: SharedPoint): Place => ({
      id: crypto.randomUUID(),
      // O nome vem depois, pela busca do nome da zona (o link nunca traz texto).
      label: formatLatLng(p.lat, p.lng),
      lat: p.lat,
      lng: p.lng,
      source: "coords",
      confidence: 1,
      dwellMinutes: p.dwellMinutes,
    });
    const sharedStops: Place[] = [];
    const sharedBreaks: RestBreak[] = [];
    const sharedLocks: Record<string, number> = {};
    let sharedArriveStop: string | null = null;
    for (const item of shared.items) {
      if (item.kind === "stop") {
        const place = toPlace(item);
        if (item.locked) sharedLocks[place.id] = sharedStops.length;
        if (item.arriveHere && (shared.time?.mode === "arrive" || shared.deadline)) sharedArriveStop = place.id;
        sharedStops.push(place);
      }
      else sharedBreaks.push({ id: crypto.randomUUID(), minutes: item.minutes, after: sharedStops.length });
    }
    const next: RouteState = {
      start: toPlace({ ...shared.start, dwellMinutes: 0 }),
      endSame: shared.end === "start",
      end: shared.end === "start" || shared.end === "none" ? null : toPlace({ ...shared.end, dwellMinutes: 0 }),
      stops: sharedStops,
      breaks: sharedBreaks,
      locks: sharedLocks,
      arriveAtStop: sharedArriveStop,
      ...(shared.deadline && sharedArriveStop ? { arriveMode: "fixed" as const, arriveAtTime: shared.deadline } : {}),
      timeMode: shared.time?.mode ?? "depart",
      dateTime: shared.time?.at ?? null,
    };
    const previous = storedRoute;
    // Fora do corpo do efeito: o aviso e a troca acontecem logo depois da montagem.
    window.setTimeout(() => {
      setRoute(next);
      notifyUndo(t.actions.opened, () => setStoredRoute(previous));
    }, 0);
    // Só na montagem: o link é lido uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const toggleDone = (id: string, announce?: (name: string) => void) => {
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
      const name = place?.label ?? t.stops.fallbackName;
      if (announce) announce(name);
      else notify(t.stops.done(name));
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
  /** Última leitura do GPS (com a direção do carro, quando se sabe). */
  const [fix, setFix] = useState<Fix | null>(null);
  /** Posição usada no último recálculo (muda de tempos em tempos, ou logo ao sair da rota). */
  const [tripOrigin, setTripOrigin] = useState<Fix | null>(null);
  /** true entre detectar que o carro saiu da rota e chegar a rota nova. */
  const [rerouting, setRerouting] = useState(false);
  /** Mapa girando com a direção da viagem: ligado sozinho no celular e no tablet. */
  const [headingUp, setHeadingUp] = useState(false);
  const [tripStats, setTripStats] = useState<TripSummary | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const lastReplanRef = useRef<Fix | null>(null);
  const lastFixRef = useRef<Fix | null>(null);
  /** Registro da viagem para as estatísticas anônimas (só números). */
  const trackRef = useRef<TripTrack | null>(null);
  const plannedLegsRef = useRef<PlannedLeg[]>([]);
  const [reportDraft, setReportDraft] = useState<TripReport["trip"] | null>(null);
  /**
   * Saída deduzida (ms): quando a viagem começa no meio do caminho, a hora em
   * que saiu do ponto anterior é estimada pela posição atual na linha do trecho.
   */
  const [tripDepartAt, setTripDepartAt] = useState<number | null>(null);
  /** Carro andando (com folga, para não ficar trocando a câmera a cada semáforo). */
  const [moving, setMoving] = useState(false);
  /** Barra de cima da viagem no celular: cada toque troca a tela (próxima parada, total, velocidade). */
  const [headerPage, setHeaderPage] = useState(0);
  /** Nome da parada de onde a pessoa se afastou (modal "seguindo para a próxima?"), ou null. */
  const [leaveAsk, setLeaveAsk] = useState<string | null>(null);
  /** Confirmação de "Nova rota" (botão do topo, na viagem). */
  const [newRouteAsk, setNewRouteAsk] = useState(false);
  /** Última vez que a mão mexeu na bandeja (celular): depois de uns segundos andando, ela recolhe. */
  const sheetTouchRef = useRef(0);
  /** Acesso local (localhost ou rede de casa): aparece a viagem de teste. */
  const localAccess = useSyncExternalStore(subscribeNever, readLocal, () => false);
  /** Viagem de teste: o GPS é simulado andando pela rota a 70 km/h. */
  const [simulating, setSimulating] = useState(false);
  const wantSimRef = useRef(false);
  /** Velocidade escolhida para o carro de teste (km/h). */
  const [simSpeedKmh, setSimSpeedKmh] = useState<number>(SIM_SPEED_KMH);
  const simRef = useRef<{
    line: readonly [number, number][] | null;
    path: readonly [number, number][] | null;
    along: number;
    pos: { lat: number; lng: number } | null;
  }>({
    line: null,
    path: null,
    along: 0,
    pos: null,
  });
  /** "Parada X concluída": aparece no cabeçalho da viagem por uns segundos, como uma conquista. */
  const [achievement, setAchievement] = useState<{ name: string; key: number } | null>(null);
  const achievementTimer = useRef(0);
  const showAchievement = (name: string) => {
    window.clearTimeout(achievementTimer.current);
    setAchievement({ name, key: nowMs() });
    achievementTimer.current = window.setTimeout(() => setAchievement(null), 4500);
  };
  /** Distância (m) da parada a partir da qual o modal aparece; sobe 1 km a cada "Ainda não". */
  const leaveAtRef = useRef(1000);
  const lastLeaveMetersRef = useRef(0);
  /** Ponto mais próximo já alcançado do destino atual (para saber que passou por ele). */
  const closestRef = useRef<{ id: string; meters: number }>({ id: "", meters: Infinity });
  /** Foto do mapa para os relatórios (a função vem do MapView). */
  const captureRef = useRef<MapCapture | null>(null);
  const [tripNumbers, setTripNumbers] = useState<{ speedKmh: number; averageKmh: number | null; reroutes: number }>({
    speedKmh: 0,
    averageKmh: null,
    reroutes: 0,
  });
  const movingRef = useRef({ fastFixes: 0, slowSince: null as number | null });
  const offRouteRef = useRef(0);
  const tripLogRef = useRef<TripLog | null>(null);
  const baselineRef = useRef<TripBaseline | null>(null);
  /** Paradas concluídas durante a viagem. */
  const stopsDoneRef = useRef(0);
  const target = start ? tripTarget(stops, doneIds, finalPlace) : null;
  /** Índice, na rota planejada, do trecho que chega na próxima parada. */
  const targetLeg = (() => {
    if (!target) return 0;
    const i = stops.findIndex((s) => s.id === target.id);
    return i === -1 ? stops.length : i;
  })();
  const pendingStops = useMemo(() => stops.filter((s) => !doneIds.has(s.id)), [stops, doneIds]);

  // Rota que falta, saindo da posição atual: as paradas pendentes na ordem combinada e o fim.
  const tripActive = trip !== null && trip.status !== "finished";
  useEffect(() => {
    tripActiveRef.current = tripActive;
  }, [tripActive]);
  const tripRequest = useMemo(() => {
    if (!tripActive || !tripOrigin) return null;
    const route = remainingRoute(herePlace(tripOrigin, t.gps.here), pendingStops, finalPlace);
    if (route.stops.length === 0 && !route.end) return null;
    // Pausas dos trechos que faltam: o trecho j da viagem é o trecho (concluídas + j) da rota.
    const offset = stops.length - pendingStops.length;
    const remainingBreaks = new Map(
      [...breakMap].filter(([leg]) => leg >= offset).map(([leg, seconds]) => [leg - offset, seconds] as [number, number]),
    );
    return {
      breakMap: remainingBreaks,
      // A direção do carro faz a rota nova sair para a frente, sem mandar dar meia-volta.
      body: JSON.stringify(
        planRequestBody({
          ...route,
          mode: "depart",
          dateTime: null,
          heading: tripOrigin.heading ?? null,
          avoidTolls: settings.avoidTolls,
        }),
      ),
      sequence: [route.start, ...route.stops, ...(route.end ? [route.end] : [])],
      at: tripOrigin.at,
    };
  }, [tripActive, tripOrigin, pendingStops, finalPlace, t.gps.here, stops.length, breakMap, settings.avoidTolls]);
  const [tripRemote, setTripRemote] = useState<{
    body: string;
    sequence: Place[];
    breakMap: Map<number, number>;
    at: number;
    outcome: PlanOutcome;
  } | null>(null);
  useEffect(() => {
    if (!tripRequest) return;
    const controller = new AbortController();
    void fetchPlan(tripRequest.body, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setTripRemote({ ...tripRequest, outcome: result });
      setRerouting(false);
      // O primeiro cálculo da viagem é o "previsto" das estatísticas.
      if (!baselineRef.current && result.kind === "ok") {
        const along = planAlong(tripRequest.sequence, result.plan, new Date(tripRequest.at), tripRequest.breakMap);
        if (along) {
          plannedLegsRef.current = along.legs.map((leg, i) => ({
            seconds: leg.seconds,
            meters: result.plan.streetLegs?.[i]?.meters ?? null,
            dwellSeconds: leg.dwellSeconds,
            restBreak: leg.breakSeconds > 0,
          }));
          baselineRef.current = {
            seconds: along.totalSeconds,
            arriveAt: along.arriveAt.getTime(),
            meters: routeMeters(tripRequest.sequence, result.plan.streetLegs).meters,
          };
        }
      }
    });
    return () => controller.abort();
  }, [tripRequest]);

  /** O que o mapa e o Resumo mostram durante a viagem (a última resposta boa, até chegar a nova). */
  const tripView = useMemo(() => {
    if (!tripActive || tripRemote?.outcome.kind !== "ok") return null;
    const tripPlan = tripRemote.outcome.plan;
    const sequence = tripRemote.sequence;
    const along = planAlong(sequence, tripPlan, new Date(tripRemote.at), tripRemote.breakMap);
    if (!along) return null;
    return {
      sequence,
      server: tripPlan,
      plan: along,
      at: tripRemote.at,
      // Cada trecho mantém a cor da parada a que chega (a mesma da lista).
      colors: sequence.slice(1).map((p) => {
        const i = stops.findIndex((s) => s.id === p.id);
        return legColor(i === -1 ? stops.length : i);
      }),
    };
  }, [tripActive, tripRemote, stops]);

  /**
   * Quanto falta até a próxima parada, ao vivo: a posição do GPS é projetada na
   * linha do trecho e o tempo e a distância do trecho são descontados do que já
   * foi percorrido.
   */
  /**
   * Estimativa local imediata (sem esperar o servidor): da posição atual, pelas
   * paradas que faltam, até o fim. O trecho em que o carro está usa o tempo
   * planejado descontado do que já foi percorrido; os outros, os tempos já
   * conhecidos do plano. Vale até a rota da viagem chegar do servidor (e ao
   * retomar uma viagem depois de fechar o navegador).
   */
  const quickTrip = useMemo(() => {
    if (!tripActive || tripView || !fix || !start) return null;
    const rest = [...pendingStops, ...(finalPlace ? [finalPlace] : [])];
    if (rest.length === 0) return null;
    const here = herePlace(fix, t.gps.here);
    const sequence = [here, ...rest];
    const plannedLine = serverPlan?.streetLegs?.[targetLeg]?.coordinates;
    const plannedSeconds = serverPlan?.legSeconds[targetLeg];
    const plannedMeters = serverPlan?.streetLegs?.[targetLeg]?.meters;
    const projection = plannedLine ? projectOnLine([fix.lng, fix.lat], plannedLine) : null;
    const onLine = projection !== null && projection.distanceM <= 300;
    const fraction = onLine ? remainingFraction(projection) : null;
    const quickLegTime: LegTimeFn = (from, to) =>
      from.id === here.id && fraction !== null && plannedSeconds
        ? { seconds: Math.round(plannedSeconds * fraction), estimated: false }
        : legTime(from, to);
    const quickPlan = computePlan(sequence, "depart", new Date(fix.at), quickLegTime, tripRequest?.breakMap ?? new Map());
    const restMeters = routeMeters(rest, serverPlan?.streetLegs?.slice(targetLeg + 1)).meters;
    const firstMeters =
      fraction !== null && plannedMeters ? plannedMeters * fraction : routeMeters(sequence.slice(0, 2), undefined).meters;
    return { plan: quickPlan, firstMeters: Math.round(firstMeters), restMeters: rest.length > 1 ? Math.round(restMeters) : 0 };
  }, [tripActive, tripView, fix, start, pendingStops, finalPlace, t.gps.here, serverPlan, targetLeg, legTime, tripRequest]);

  const live = useMemo(() => {
    if (!tripView) {
      // Enquanto a rota da viagem não chega: a estimativa local, na hora.
      if (!quickTrip || !fix) return null;
      const first = quickTrip.plan.legs[0];
      if (!first) return null;
      return {
        nextSeconds: first.seconds,
        nextMeters: quickTrip.firstMeters,
        estimated: true,
        nextArriveAt: first.arriveAt,
        endArriveAt: quickTrip.plan.arriveAt,
        totalSeconds: quickTrip.plan.totalSeconds,
        totalMeters: quickTrip.firstMeters + quickTrip.restMeters,
        startedAt: new Date(fix.at),
      };
    }
    const leg = tripView.plan.legs[0];
    if (!leg) return null;
    const line = tripView.server.streetLegs?.[0]?.coordinates;
    const legMeters = routeMeters(tripView.sequence.slice(0, 2), tripView.server.streetLegs?.slice(0, 1));
    const projection = fix && line ? projectOnLine([fix.lng, fix.lat], line) : null;
    const fraction = projection && projection.distanceM <= snapRadius(fix?.accuracy ?? 30) ? remainingFraction(projection) : 1;
    const now = fix?.at ?? tripView.at;
    const nextSeconds = Math.round(leg.seconds * fraction);
    // O resto da rota (as outras paradas e a permanência) não muda com o avanço no trecho.
    const restSeconds = tripView.plan.totalSeconds - leg.seconds;
    return {
      nextSeconds,
      nextMeters: Math.round(legMeters.meters * fraction),
      estimated: legMeters.estimated,
      nextArriveAt: new Date(now + nextSeconds * 1000),
      endArriveAt: new Date(now + (nextSeconds + restSeconds) * 1000),
      totalSeconds: nextSeconds + restSeconds,
      totalMeters: Math.round(
        routeMeters(tripView.sequence, tripView.server.streetLegs).meters - legMeters.meters * (1 - fraction),
      ),
      startedAt: new Date(now),
    };
  }, [tripView, fix, quickTrip]);

  const finishTrip = (at: number, arrivedAtEnd = true) => {
    const log = tripLogRef.current ?? newTripLog(at);
    const summary = summarizeTrip(log, baselineRef.current, at, stopsDoneRef.current);
    setTripStats(summary);
    if (trackRef.current) {
      const track = arrivedAtEnd ? trackArrive(trackRef.current, at) : trackRef.current;
      setReportDraft(
        tripReportOf(
          track,
          summary,
          plannedLegsRef.current,
          {
            stopsPlanned: stops.length,
            roundTrip: endSame,
            hasEnd: finalPlace !== null,
            restBreaks: breaks.length,
            restBreakMinutes: breaks.reduce((sum, b) => sum + b.minutes, 0),
            headingUp,
          },
          at,
        ),
      );
    }
    setStatsOpen(true);
    // Viagem concluída: ela não volta mais na próxima vez que o app abrir (a tela atual fica como está).
    forgetStoredCopy(ROUTE_KEY);
    setTrip({ status: "finished" });
  };

  const onFix = useEffectEvent((raw: Fix, gps: { heading: number | null; speed: number | null }) => {
    // Direção: a do GPS em movimento, ou a do deslocamento; parado, fica a última conhecida.
    const heading = headingFrom(lastFixRef.current, raw, gps) ?? lastFixRef.current?.heading ?? null;
    const next: Fix = { ...raw, heading };
    const previousFix = lastFixRef.current;
    lastFixRef.current = next;

    // Andando ou parado: velocidade do GPS, ou a do deslocamento entre leituras.
    const dt = previousFix ? (next.at - previousFix.at) / 1000 : 0;
    const speed =
      gps.speed !== null && Number.isFinite(gps.speed)
        ? gps.speed
        : previousFix && dt > 0
          ? haversineMeters(previousFix, next) / dt
          : 0;
    const motion = movingRef.current;
    if (speed >= 2.8) {
      // ~10 km/h em duas leituras seguidas: começou a andar.
      motion.fastFixes += 1;
      motion.slowSince = null;
      if (motion.fastFixes >= 2) setMoving(true);
    } else {
      motion.fastFixes = 0;
      if (speed < 1) {
        motion.slowSince ??= next.at;
        // Parado há uns 8 s (não só freando): volta a mostrar a rota inteira.
        if (next.at - motion.slowSince >= 8_000) setMoving(false);
      }
    }

    // Começou a viagem no meio do caminho: deduz a hora em que saiu do ponto
    // anterior pela fração do trecho já percorrida (aproximado, pelo tempo do trecho).
    if (!previousFix && serverPlan?.streetLegs) {
      const line = serverPlan.streetLegs[targetLeg]?.coordinates;
      const legSeconds = serverPlan.legSeconds[targetLeg];
      const projection = line ? projectOnLine([next.lng, next.lat], line) : null;
      if (projection && legSeconds && projection.distanceM <= 300) {
        const done = 1 - remainingFraction(projection);
        if (done > 0.03) setTripDepartAt(next.at - Math.round(done * legSeconds * 1000));
      }
    }
    setFix(next);
    if (tripLogRef.current) tripLogRef.current = logFix(tripLogRef.current, next);
    // Números da barra de cima (segunda e terceira telas).
    setTripNumbers({
      speedKmh: speed * 3.6,
      averageKmh: tripLogRef.current ? summarizeTrip(tripLogRef.current, null, next.at, 0).averageKmh : null,
      reroutes: trackRef.current?.reroutes ?? 0,
    });
    if (trackRef.current) trackRef.current = trackFix(trackRef.current, next);

    // Parado numa parada (antes de retomar): a seta acompanha, mas a rota não é
    // recalculada. A 1 km dela, pergunta se já segue para a próxima (pode ser só
    // uma manobra, por isso não segue sozinho).
    if (trip?.status === "arrived") {
      const arrivedStop = trip.arrivedId ? stops.find((s) => s.id === trip.arrivedId) : undefined;
      const away = arrivedStop ? haversineMeters(next, arrivedStop) : 0;
      if (arrivedStop && leaveAsk === null && away >= leaveAtRef.current) {
        leaveAtRef.current = Infinity;
        lastLeaveMetersRef.current = away;
        setLeaveAsk(arrivedStop.label);
      }
      return;
    }

    // Saiu da rota? Mede a distância até a linha do trecho atual; duas leituras
    // seguidas longe dela pedem uma rota nova já, saindo na direção do carro.
    const line = tripView?.server.streetLegs?.[0]?.coordinates;
    // Com o carro andando, a direção dele escolhe a mão certa da via; andar no
    // sentido contrário ao da rota (contramão da linha) também conta como desvio.
    const movingNow = speed >= 2.8 && next.heading !== null;
    const projection = line ? projectOnLine([next.lng, next.lat], line, movingNow ? next.heading : null) : null;
    const wrongWay = movingNow && projection?.against === true && projection.distanceM <= snapRadius(next.accuracy);
    offRouteRef.current =
      projection && (isOffRoute(projection.distanceM, next.accuracy) || wrongWay) ? offRouteRef.current + 1 : 0;
    const reroute = shouldReroute(lastReplanRef.current, next, offRouteRef.current);
    if (reroute || shouldReplan(lastReplanRef.current, next)) {
      lastReplanRef.current = next;
      offRouteRef.current = 0;
      // Parado, o GPS não sabe a direção: vale o sentido da via na rota atual
      // (que já respeita a mão), para a rota nova não mandar dar meia-volta.
      const legalHeading =
        projection && !projection.against && projection.distanceM <= snapRadius(next.accuracy) ? projection.bearing : null;
      setTripOrigin(next.heading === null && legalHeading !== null ? { ...next, heading: legalHeading } : next);
      if (reroute) {
        setRerouting(true);
        if (trackRef.current) trackRef.current = trackReroute(trackRef.current);
      }
    }

    if (!target) {
      finishTrip(next.at);
      return;
    }
    // Chegou perto o bastante, ou chegou bem perto e já se afasta (passou pelo ponto).
    const meters = haversineMeters(next, target);
    if (closestRef.current.id !== target.id) closestRef.current = { id: target.id, meters: Infinity };
    const closestBefore = closestRef.current.meters;
    closestRef.current.meters = Math.min(closestBefore, meters);
    const passed = trip?.status === "running" && hasPassed(closestBefore, meters);
    if (!hasArrived(next, target) && !passed) return;
    // Chegou: numa parada, pausa até a pessoa retomar; no ponto final, a viagem acaba.
    if (stops.some((s) => s.id === target.id)) {
      if (tripLogRef.current) tripLogRef.current = logStop(tripLogRef.current, next.at);
      if (trackRef.current) trackRef.current = trackArrive(trackRef.current, next.at);
      leaveAtRef.current = 1000;
      setTrip({ status: "arrived", arrivedId: target.id });
    } else {
      finishTrip(next.at);
    }
  });
  const onGpsError = useEffectEvent((error: GeolocationPositionError) => {
    // Sem permissão não há o que acompanhar; falhas passageiras (túnel, sinal fraco) são ignoradas.
    if (error.code !== error.PERMISSION_DENIED) return;
    notify(t.gps.denied);
    if (tripLogRef.current) tripLogRef.current = logStop(tripLogRef.current, nowMs());
    setTrip((current) => (current?.status === "running" ? { status: "paused" } : current));
  });
  const tripRunning = trip?.status === "running";
  /** GPS ligado: andando ou parado numa parada (a seta continua acompanhando o carro). */
  const gpsOn = tripRunning || trip?.status === "arrived";
  // Celular, viagem e carro andando: sem mexer na bandeja por alguns segundos, ela recolhe sozinha.
  useEffect(() => {
    if (isDesktop || !tripRunning || !moving || !sheetOpen) return;
    sheetTouchRef.current = nowMs();
    const timer = window.setInterval(() => {
      if (nowMs() - sheetTouchRef.current >= SHEET_IDLE_MS) setSheetOpen(false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isDesktop, tripRunning, moving, sheetOpen]);
  /** Uma leitura do carro de teste: anda SIM_SPEED_MS pela linha do trecho atual (parado na parada). */
  const simTick = useEffectEvent(() => {
    const sim = simRef.current;
    const line = (tripView?.server.streetLegs?.[0]?.coordinates ?? serverPlan?.streetLegs?.[targetLeg]?.coordinates ?? null) as
      | readonly [number, number][]
      | null;
    if (!line || line.length < 2) return;
    // Rota nova (recálculo ou próximo trecho): continua de onde o carro está nela. O carro de teste
    // termina em cima da própria parada (a linha da via pode acabar a dezenas de metros dela).
    if (sim.line !== line) {
      sim.line = line;
      sim.path = target ? [...line, [target.lng, target.lat]] : line;
      sim.along = sim.pos ? (projectOnLine([sim.pos.lng, sim.pos.lat], sim.path)?.alongM ?? 0) : 0;
    }
    const path = sim.path;
    if (!path || path.length < 2) return;
    const driving = trip?.status === "running";
    const speedMs = simSpeedKmh / 3.6;
    if (driving) sim.along += speedMs * (SIM_INTERVAL_MS / 1000);
    const p = pointAlong(path, sim.along);
    sim.pos = { lat: p.lat, lng: p.lng };
    onFix(
      { lat: p.lat, lng: p.lng, accuracy: 8, at: nowMs() },
      { heading: driving && !p.atEnd ? p.heading : null, speed: driving && !p.atEnd ? speedMs : 0 },
    );
  });
  useEffect(() => {
    if (!gpsOn) return;
    if (simulating) {
      const timer = window.setInterval(() => simTick(), SIM_INTERVAL_MS);
      return () => window.clearInterval(timer);
    }
    const watch = navigator.geolocation.watchPosition(
      (position) =>
        onFix(
          {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            at: position.timestamp,
          },
          { heading: position.coords.heading, speed: position.coords.speed },
        ),
      (error) => onGpsError(error),
      // maximumAge 0: cada leitura é nova, para a seta andar sem saltos.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [gpsOn, simulating]);

  const clearTrip = () => {
    lastReplanRef.current = null;
    lastFixRef.current = null;
    offRouteRef.current = 0;
    baselineRef.current = null;
    stopsDoneRef.current = 0;
    setFix(null);
    setTripOrigin(null);
    setTripRemote(null);
    setRerouting(false);
    setInfo(null);
    setTripDepartAt(null);
    setMoving(false);
    movingRef.current = { fastFixes: 0, slowSince: null };
  };
  const beginTrip = () => {
    setTripWarning(false);
    // Daqui em diante a ordem é só sua: todas as paradas ficam travadas onde estão e nada
    // muda sozinho (nem recálculo de ordem, nem sugestão da IA). Mudar é sempre ação manual.
    setRoute((prev) => ({ ...prev, locks: Object.fromEntries(displayedIds.map((id, i) => [id, i])) }));
    const simulate = wantSimRef.current && localAccess;
    wantSimRef.current = false;
    setSimulating(simulate);
    simRef.current = { line: null, path: null, along: 0, pos: null };
    if (!simulate && !("geolocation" in navigator)) {
      notify(t.gps.unsupported);
      return;
    }
    clearTrip();
    const startedAt = nowMs();
    tripLogRef.current = newTripLog(startedAt);
    trackRef.current = newTrack(startedAt);
    plannedLegsRef.current = [];
    setTripStats(null);
    setReportDraft(null);
    // No celular, a gaveta recolhe e mostra só a próxima parada.
    if (!isDesktop) setSheetOpen(false);
    // No celular e no tablet o mapa gira com a viagem, como nos GPS; no computador, só se a pessoa ligar.
    setHeadingUp(isCompact);
    setTrip({ status: "running" });
  };
  const pauseTrip = () => {
    const now = nowMs();
    if (tripLogRef.current) tripLogRef.current = logStop(tripLogRef.current, now);
    if (trackRef.current) trackRef.current = trackPause(trackRef.current, now);
    setTrip((current) => (current?.status === "running" ? { status: "paused" } : current));
  };
  const resumeTrip = () => {
    // Como ao iniciar: no celular, a bandeja do Resumo recolhe para o mapa aparecer.
    if (!isDesktop) setSheetOpen(false);
    const now = nowMs();
    // Retomar depois de chegar: a parada fica concluída e o acompanhamento segue para a próxima.
    if (trip?.status === "arrived" && trip.arrivedId) {
      const arrivedId = trip.arrivedId;
      // Na viagem, no celular: a conquista entra no cabeçalho (o aviso branco cobria a velocidade).
      if (!doneIds.has(arrivedId)) toggleDone(arrivedId, isCompact ? showAchievement : undefined);
      stopsDoneRef.current += 1;
      // Era a última parada e a rota termina nela: a viagem acaba na hora em que chegou.
      if (!tripTarget(stops, new Set([...doneIds, arrivedId]), finalPlace)) {
        finishTrip(tripLogRef.current?.stoppedSince ?? now, false);
        return;
      }
      if (trackRef.current) trackRef.current = trackLeave(trackRef.current, now);
    } else if (trackRef.current) {
      trackRef.current = trackResume(trackRef.current, now);
    }
    if (tripLogRef.current) tripLogRef.current = logGo(tripLogRef.current, now);
    lastReplanRef.current = null;
    offRouteRef.current = 0;
    setTrip({ status: "running" });
  };
  const endTrip = () => {
    clearTrip();
    tripLogRef.current = null;
    setStatsOpen(false);
    setTrip(null);
    // Viagem encerrada à mão (ou o botão Fechar depois de concluída): também sai do armazenamento.
    forgetStoredCopy(ROUTE_KEY);
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
        ? [{ id: start.id, lat: start.lat, lng: start.lng, kind: "start" as const, badge: endSame ? ROUND_TRIP_BADGE : "A", title: start.label }]
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
    () =>
      tripView
        ? tripView.server.streetLegs
          ? []
          : tripView.sequence.map((p) => [p.lng, p.lat])
        : tripActive && streetLegs
          ? []
          : path,
    [tripView, tripActive, streetLegs, path],
  );
  const mapStreetLegs = useMemo(
    () =>
      tripView
        ? (tripView.server.streetLegs?.map((leg) => leg.coordinates) ?? null)
        : tripActive && streetLegs
          ? streetLegs.slice(targetLeg)
          : streetLegs,
    [tripView, tripActive, streetLegs, targetLeg],
  );
  const mapLegColors = useMemo(
    () => (!tripView && tripActive ? view.colors.slice(targetLeg) : view.colors),
    [tripView, tripActive, view.colors, targetLeg],
  );
  /**
   * Etiquetas de tempo e distância em cima de cada trecho. Só na visão 2D: com o
   * carro andando (câmera de perto, em 3D) elas somem para não poluir o mapa.
   */
  const mapLegLabels = useMemo(() => {
    if (tripActive && moving) return null;
    const legs = tripView ? tripView.server.streetLegs : tripActive ? serverPlan?.streetLegs?.slice(targetLeg) : serverPlan?.streetLegs;
    return legs?.map((leg) => `${formatDuration(leg.seconds)} · ${formatKm(leg.meters)}`) ?? null;
  }, [tripActive, moving, tripView, serverPlan, targetLeg]);
  // ---------- Relatórios (de saída e final) ----------
  /** Linhas da tabela de paradas: cada trecho do plano e a parada em que ele chega. */
  const reportRows = (): ReportRow[] =>
    (plan?.legs ?? []).map((leg, i) => ({
      n: i < stops.length ? String(i + 1) : endSame ? ROUND_TRIP_BADGE : "B",
      name: leg.to.label,
      arriveAt: leg.arriveAt,
      dwellSeconds: leg.dwellSeconds,
      leaveAt: i < stops.length ? leg.leaveAt : null,
      legSeconds: leg.seconds,
      legMeters: serverPlan?.streetLegs?.[i]?.meters ?? null,
      breakSeconds: leg.breakSeconds,
      locked: i < stops.length && locks[stops[i].id] !== undefined,
      mustArrive:
        i < stops.length && route.arriveAtStop === stops[i].id && (arriveLeg !== null || holdAtMs !== null)
          ? formatTime(leg.arriveAt)
          : null,
      waitSeconds: leg.waitSeconds,
    }));
  /** Texto das condições do relatório: travas e chegada obrigatória. */
  const reportConstraints = (): ReportConstraints => {
    const mandatoryIndex = arriveLeg !== null || holdAtMs !== null ? arriveIndex : -1;
    const mandatoryLeg = mandatoryIndex >= 0 ? plan?.legs[mandatoryIndex] : undefined;
    return {
      locked: stops.flatMap((s, i) => (locks[s.id] !== undefined ? [{ n: String(i + 1), name: s.label }] : [])),
      mandatory:
        mandatoryIndex >= 0 && mandatoryLeg
          ? {
              n: mandatoryIndex + 1,
              name: stops[mandatoryIndex].label,
              time: formatTime(mandatoryLeg.arriveAt),
              mode: holdAtMs !== null ? "fixed" : "back",
              slackMinutes: holdAtMs !== null && serverPlan?.deadline ? serverPlan.deadline.slackSeconds / 60 : null,
            }
          : null,
    };
  };
  /** Monta o relatório e devolve o PDF (null = não deu para gerar). */
  const buildReportPdf = async (kind: "departure" | "final"): Promise<Blob | null> => {
    if (!start) return null;
    try {
      const mapImage = (await captureRef.current?.().catch(() => null)) ?? null;
      const common = {
        locale,
        version: pkg.version,
        generatedAt: new Date(),
        mapImage,
        logoUrl: `${window.location.origin}/email-logo.png`,
        constraints: reportConstraints(),
        startName: start.label,
        endName: endSame ? null : (end?.label ?? null),
        roundTrip: endSame,
      };
      let html: string;
      if (kind === "departure") {
        if (!plan) return null;
        html = departureReportHtml({
          ...common,
          departAt: plan.departAt,
          arriveAt: plan.arriveAt,
          totalSeconds: plan.totalSeconds,
          driveSeconds: plan.driveSeconds,
          dwellSeconds: plan.dwellSeconds,
          breakSeconds: plan.breakSeconds,
          totalMeters: totalDistance?.meters ?? null,
          rows: reportRows(),
          aiComment: aiOutcome?.review?.explanation ?? null,
        });
      } else {
        if (!tripStats || !reportDraft) return null;
        // Análise técnica da IA (opcional): sem ela, o relatório sai do mesmo jeito.
        const analysis = await fetch("/api/ai/trip-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale, trip: reportDraft }),
        })
          .then((res) => (res.ok ? (res.json() as Promise<{ analysis: TripAnalysis | null }>) : null))
          .then((data) => data?.analysis ?? null)
          .catch(() => null);
        html = finalReportHtml({ ...common, summary: tripStats, trip: reportDraft, rows: reportRows(), analysis });
      }
      const title = kind === "departure" ? `${t.actions.departureReport}` : t.trip.stats.finalReport;
      return await htmlToPdf(html, title.replace(/\s*\(PDF\)\s*$/, ""));
    } catch {
      return null;
    }
  };
  const reportFileName = (kind: "departure" | "final") => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `${kind === "departure" ? "relatorio-saida" : "relatorio-final"}-${day}.pdf`;
  };
  /** Relatório de saída: gera e baixa o PDF na hora. */
  const makeDepartureReport = async () => {
    notify(t.actions.reportPreparing);
    const blob = await buildReportPdf("departure");
    if (blob) downloadBlob(blob, reportFileName("departure"));
    else notify(t.actions.reportBlocked);
  };
  /**
   * Relatório final: começa a ser gerado assim que a viagem termina (o botão só
   * entrega o arquivo pronto, ou espera o que falta). Se a pessoa não quiser, é só ignorar.
   */
  const finalPdfRef = useRef<Promise<Blob | null> | null>(null);
  const downloadFinalReport = async () => {
    finalPdfRef.current ??= buildReportPdf("final");
    const blob = await finalPdfRef.current;
    if (blob) downloadBlob(blob, reportFileName("final"));
    else {
      finalPdfRef.current = null;
      notify(t.actions.reportBlocked);
    }
  };
  useEffect(() => {
    if (!statsOpen) {
      finalPdfRef.current = null;
      return;
    }
    if (!tripStats || !reportDraft || finalPdfRef.current) return;
    // Depois do primeiro desenho do modal: o mapa já voltou ao 2D.
    const timer = window.setTimeout(() => {
      finalPdfRef.current ??= buildReportPdf("final");
    }, 1800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsOpen, tripStats, reportDraft]);

  /**
   * Horários da lista durante a viagem: as paradas que faltam ganham a chegada
   * ao vivo (da posição atual), as concluídas ficam com o que foi planejado.
   */
  const listLegs = useMemo(() => {
    if (!plan || !tripActive || !live) return plan?.legs;
    const tripPlan = tripView?.plan ?? quickTrip?.plan;
    if (!tripPlan || tripPlan.legs.length === 0) return plan.legs;
    // Desloca o plano da viagem para bater com a chegada ao vivo na próxima parada.
    const shift = live.nextArriveAt.getTime() - tripPlan.legs[0].arriveAt.getTime();
    return plan.legs.map((leg, i) => {
      const stop = stops[i];
      if (stop && doneIds.has(stop.id)) return leg;
      const toId = stop?.id ?? finalPlace?.id;
      const liveLeg = tripPlan.legs.find((l) => l.to.id === toId) ?? (stop ? null : tripPlan.legs[tripPlan.legs.length - 1]);
      if (!liveLeg) return leg;
      const first = liveLeg === tripPlan.legs[0];
      return {
        ...leg,
        seconds: first ? live.nextSeconds : liveLeg.seconds,
        estimated: liveLeg.estimated || (first && live.estimated),
        arriveAt: new Date(liveLeg.arriveAt.getTime() + shift),
        leaveAt: new Date(liveLeg.leaveAt.getTime() + shift),
      };
    });
  }, [plan, tripActive, live, tripView, quickTrip, stops, doneIds, finalPlace]);

  /** Pontos da visão geral (carro parado): onde está e o que falta. */
  const overviewPoints = useMemo<[number, number][]>(() => {
    if (!tripActive) return [];
    const rest = tripView ? tripView.sequence.slice(1) : sequenceOf(stops).slice(targetLeg + 1);
    return [...(fix ? [[fix.lng, fix.lat] as [number, number]] : []), ...rest.map((p) => [p.lng, p.lat] as [number, number])];
  }, [tripActive, tripView, sequenceOf, stops, targetLeg, fix]);

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
            planRequestBody({
              start,
              stops: typedStops,
              end,
              endSame,
              locks: suggestionLocks,
              mode: timeMode,
              dateTime,
              avoidTolls: settings.avoidTolls,
            }),
          )
        : null,
    [suggestionLocks, start, typedStops, end, endSame, timeMode, dateTime, settings.avoidTolls],
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
      right: isDesktop && layoutBlocks.right.length > 0 ? RIGHT_BLOCK_WIDTH_REM * fontPx + EDGE_MARGIN : 0,
    }),
    [isDesktop, layoutBlocks.left.length, layoutBlocks.right.length, blockWidthPx, fontPx],
  );

  // Textos de resumo. O total inclui a permanência nas paradas.
  const totalText = plan ? formatDuration(plan.totalSeconds) : "—";
  const arriveText = plan ? formatTimeWithDay(plan.arriveAt, plan.departAt) : "—";
  const handleSummary = !start
    ? t.empty.handle
    : tripActive && target
      ? isCompact
        ? t.app.panel
        : `${t.trip.next}: ${target.label}`
      : `${totalText} · ${t.common.stops(stops.length)} · ${t.summary.arrivesAt(arriveText)}`;
  const liveKm = live ? `${live.estimated ? "≈ " : ""}${formatKm(live.nextMeters)}` : "—";
  const statsShort = tripStats
    ? t.trip.finishedShort(
        formatDuration(tripStats.actualSeconds),
        tripStats.plannedSeconds === null ? null : formatDuration(tripStats.plannedSeconds),
        formatKm(tripStats.actualMeters),
      )
    : null;
  const distanceText = totalDistance ? `${totalDistance.estimated ? "≈ " : ""}${formatKm(totalDistance.meters)}` : "—";

  // Painel da viagem, no Resumo.
  const tripPanel = (() => {
    const buttonBase =
      "focus-ring flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-compact font-semibold transition-colors duration-150 motion-reduce:transition-none";
    const primary = `${buttonBase} bg-accent text-white hover:bg-accent/90 dark:text-[#10131c]`;
    const secondary = `${buttonBase} border border-line-strong text-ink-2 hover:bg-hover hover:text-ink`;
    if (!trip) {
      const startButton = (
        <button
          type="button"
          onClick={() => {
            wantSimRef.current = false;
            setTripWarning(true);
          }}
          disabled={!plan || !target}
          className={`${primary} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <PlayIcon />
          {t.trip.start}
        </button>
      );
      if (!localAccess) return startButton;
      // Acesso local: também a viagem de teste, com o carro simulado a 70 km/h.
      return (
        <div className="flex flex-col gap-2">
          {startButton}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                wantSimRef.current = true;
                setTripWarning(true);
              }}
              disabled={!plan || !target || !serverPlan?.streetLegs}
              className={`${secondary} flex-1 border-dashed disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <PlayIcon />
              {t.trip.testTrip}
            </button>
            <label className="sr-only" htmlFor="velocidade-teste">
              {t.trip.testSpeed}
            </label>
            <select
              id="velocidade-teste"
              title={t.trip.testSpeed}
              value={simSpeedKmh}
              onChange={(e) => setSimSpeedKmh(Number(e.target.value))}
              className={`${selectClass} w-28 shrink-0`}
            >
              {SIM_SPEEDS_KMH.map((kmh) => (
                <option key={kmh} value={kmh}>
                  {kmh} km/h
                </option>
              ))}
            </select>
          </div>
        </div>
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
          {simulating && (
            <span className="rounded border border-dashed border-line-strong px-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
              {t.trip.testTag}
            </span>
          )}
        </p>
        {(trip.status === "running" || trip.status === "paused") && target && (
          <div className="flex flex-col gap-0.5">
            <p className="truncate text-compact text-ink">
              <span className="text-muted">{t.trip.next}:</span> <span className="font-medium">{target.label}</span>
            </p>
            <p className="text-xs text-muted">
              {rerouting
                ? t.trip.rerouting
                : live
                  ? t.trip.eta(formatTime(live.nextArriveAt), formatDuration(live.nextSeconds), liveKm)
                  : fix
                    ? t.trip.updating
                    : t.trip.waitingGps}
            </p>
            {live && tripView && tripView.sequence.length > 2 && (
              <p className="text-xs text-muted">
                {t.trip.endEta(formatTimeWithDay(live.endArriveAt, live.startedAt))}
              </p>
            )}
          </div>
        )}
        {trip.status === "arrived" && <p className="text-xs text-muted">{t.trip.arrivedHint}</p>}
        {trip.status === "finished" && statsShort && <p className="text-xs text-ink-2">{statsShort}</p>}
        <div className="flex flex-wrap gap-2">
          {trip.status === "running" && (
            <button type="button" onClick={pauseTrip} className={`${secondary} flex-1`}>
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
            <>
              {tripStats && (
                <button type="button" onClick={() => setStatsOpen(true)} className={`${primary} flex-1`}>
                  <FlagIcon />
                  {t.trip.seeStats}
                </button>
              )}
              <button type="button" onClick={endTrip} className={`${secondary} flex-1`}>
                {t.trip.close}
              </button>
            </>
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

  /** Parada em que o carro está "em cima" (até 60 m dela, depois de chegar): a seta gruda nela. */
  const goalStop =
    trip?.status === "arrived" && trip.arrivedId && fix
      ? (stops.find((s) => s.id === trip.arrivedId && haversineMeters(fix, s) <= GOAL_MAGNET_M) ?? null)
      : null;
  const meOnMap: MePosition | null =
    tripActive && fix
      ? goalStop
        ? { lat: goalStop.lat, lng: goalStop.lng, heading: null, accuracy: fix.accuracy, at: fix.at, goal: true }
        : { lat: fix.lat, lng: fix.lng, heading: fix.heading ?? null, accuracy: fix.accuracy, at: fix.at }
      : null;
  /** Pins do mapa: o da parada some enquanto a bandeira está em cima dela. */
  const mapPoints = goalStop ? points.filter((p) => p.id !== goalStop.id) : points;

  // Celular e tablet: cartão da viagem no topo (estado, próxima parada, números e botões). É o único
  // lugar dos botões de pausar, retomar e encerrar; os botões do mapa ficam numa fileira acima dele.
  /** Parada seguinte à que acabou de chegar (o que "Próxima" vai acompanhar), quando já se está parado numa parada. */
  const tripNextAfterArrival =
    trip?.status === "arrived" && trip.arrivedId
      ? tripTarget(stops, new Set([...doneIds, trip.arrivedId]), finalPlace)
      : null;
  const tripStatusColor =
    trip === null
      ? ""
      : trip.status === "running"
        ? "bg-emerald-500 animate-pulse motion-reduce:animate-none"
        : trip.status === "arrived"
          ? // Parado na parada: vermelho. Já se afastou sem tocar em "Próxima": amarelo.
            fix && !goalStop
            ? "bg-amber-400"
            : "bg-red-500"
          : trip.status === "paused"
            ? "bg-amber-400"
            : "bg-emerald-500";
  const tripHeader =
    isCompact && trip !== null ? (
      <div
        aria-live="polite"
        className="fixed left-[var(--trip-card-x)] top-[calc(env(safe-area-inset-top)+3.75rem)] z-20 flex w-[var(--trip-card-w)] flex-col gap-2 overflow-hidden rounded-2xl border border-line bg-surface/95 p-3 shadow-panel backdrop-blur-sm"
      >
        <div className="flex flex-col gap-0.5">
          <p className="flex items-center gap-2 text-compact font-semibold text-accent">
            <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${tripStatusColor}`} />
            <span className="truncate">
              {trip.status === "running"
                ? t.trip.running
                : trip.status === "paused"
                  ? t.trip.paused
                  : trip.status === "arrived"
                    ? t.trip.arrived(stops.find((x) => x.id === trip.arrivedId)?.label ?? t.stops.fallbackName)
                    : t.trip.finished}
            </span>
            {simulating && (
              <span className="rounded border border-dashed border-line-strong px-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
                {t.trip.testTag}
              </span>
            )}
          </p>
          {trip.status !== "finished" && (trip.status === "arrived" ? tripNextAfterArrival : target) && (
            <p className="truncate text-md font-semibold text-ink">
              {t.trip.next}: {(trip.status === "arrived" ? tripNextAfterArrival : target)?.label}
            </p>
          )}
        </div>

        {trip.status !== "finished" &&
          (achievement ? (
            // Conquista: entra deslizando no lugar dos números, com o "OK" verde.
            <div key={achievement.key} role="status" className="rotas-achieve flex items-center gap-2.5 py-1">
              <span className="rotas-achieve-check grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow-[0_0_0_4px_rgb(16_185_129/0.25)]">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-2xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  {t.trip.achieveLabel}
                </span>
                <span className="truncate text-compact font-semibold text-ink">{t.trip.achieved(achievement.name)}</span>
              </span>
            </div>
          ) : rerouting || !live ? (
            <p className="py-1 text-compact font-medium text-ink-2">
              {rerouting ? t.trip.rerouting : fix ? t.trip.updating : t.trip.waitingGps}
            </p>
          ) : (
            // Cada toque nos números troca a tela: próxima parada, totais da rota, velocidade.
            <button
              type="button"
              title={t.trip.headerHint}
              onClick={() => setHeaderPage((page) => (page + 1) % 3)}
              className="focus-ring -mx-1 rounded-lg px-1 text-left transition-colors active:bg-hover"
            >
              <dl className="grid grid-cols-3 gap-2">
                {(
                  headerPage === 1
                    ? [
                        [t.trip.headerEndArrival, formatTime(live.endArriveAt)],
                        [t.trip.headerTotalTime, formatDuration(live.totalSeconds)],
                        [t.trip.headerTotalDistance, `${live.estimated ? "≈ " : ""}${formatKm(live.totalMeters)}`],
                      ]
                    : headerPage === 2
                      ? [
                          [t.trip.headerSpeed, `${Math.round(tripNumbers.speedKmh)} km/h`],
                          [t.trip.headerAverage, tripNumbers.averageKmh === null ? "—" : `${Math.round(tripNumbers.averageKmh)} km/h`],
                          [t.trip.headerReroutes, String(tripNumbers.reroutes)],
                        ]
                      : [
                          [t.trip.headerArrival, formatTime(live.nextArriveAt)],
                          [t.trip.headerTime, formatDuration(live.nextSeconds)],
                          [t.trip.headerDistance, liveKm],
                        ]
                ).map(([label, value]) => (
                  <div key={label} className="flex flex-col">
                    <dt className="text-xs font-medium text-muted">{label}</dt>
                    <dd className="whitespace-nowrap text-xl font-semibold tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </button>
          ))}

        {trip.status === "arrived" && <p className="text-xs text-muted">{t.trip.arrivedHint}</p>}
        {trip.status === "finished" && statsShort && <p className="text-xs text-ink-2">{statsShort}</p>}

        <div className="flex items-center justify-end gap-2">
          {/* Qual das três telas de números está aparecendo: o ponto da tela atual vira um traço. */}
          {trip.status !== "finished" && live && !rerouting && !achievement && (
            <span aria-hidden="true" className="mr-auto flex items-center gap-1.5">
              {[0, 1, 2].map((page) => (
                <span
                  key={page}
                  className={`h-2 rounded-full transition-all duration-200 motion-reduce:transition-none ${
                    page === headerPage ? "w-5 bg-accent" : "w-2 bg-line-strong"
                  }`}
                />
              ))}
            </span>
          )}
          {trip.status === "running" && (
            <button type="button" onClick={pauseTrip} className={tripCardSecondary}>
              <PauseIcon />
              {t.trip.pause}
            </button>
          )}
          {trip.status === "paused" && (
            <button type="button" onClick={resumeTrip} className={tripCardPrimary}>
              <PlayIcon />
              {t.trip.resume}
            </button>
          )}
          {trip.status === "arrived" && (
            <button type="button" onClick={resumeTrip} className={tripCardPrimary}>
              {t.trip.next}
            </button>
          )}
          {trip.status === "finished" && tripStats && (
            <button type="button" onClick={() => setStatsOpen(true)} className={tripCardPrimary}>
              <FlagIcon />
              {t.trip.seeStats}
            </button>
          )}
          <button type="button" onClick={endTrip} className={tripCardSecondary}>
            {trip.status === "finished" ? null : <StopIcon />}
            {trip.status === "finished" ? t.trip.close : t.trip.end}
          </button>
        </div>
      </div>
    ) : null;

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
                {timeMode === "arrive" && stops.length > 0 && (
                  <label className="mt-2 flex flex-col gap-1 text-xs font-medium text-ink-2">
                    {t.startEnd.arriveAtLabel}
                    <select
                      className={`${selectClass} w-full`}
                      value={arriveLeg === null ? "" : (route.arriveAtStop ?? "")}
                      onChange={(e) => setRoute((prev) => ({ ...prev, arriveAtStop: e.target.value || null }))}
                    >
                      <option value="">{t.startEnd.arriveAtEnd}</option>
                      {stops.map((stop, i) => (
                        <option key={stop.id} value={stop.id}>
                          {t.startEnd.arriveAtStop(i + 1, stop.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
              {stops.length === 0 && breaks.length === 0 ? (
                <p className="text-sm text-muted">
                  {t.stops.empty}
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted">
                    {t.stops.hint}
                  </p>
                  <StopList
                    arriveAtStop={arriveLeg !== null || holdAtMs !== null ? (route.arriveAtStop ?? null) : null}
                    arriveTime={(route.arriveMode === "fixed" ? route.arriveAtTime : dateTime)?.slice(11, 16) ?? ""}
                    arriveMode={route.arriveMode ?? "back"}
                    onArriveAt={(id, time, mode) =>
                      setRoute((prev) => {
                        if (time === null) {
                          // Tira a hora: no "recuar", volta a "sair agora"; no "manter", a saída continua.
                          return prev.arriveMode === "fixed"
                            ? { ...prev, arriveAtStop: null, arriveAtTime: null, arriveMode: "back" }
                            : { ...prev, arriveAtStop: null, arriveMode: "back", timeMode: "depart", dateTime: null };
                        }
                        const pad = (n: number) => String(n).padStart(2, "0");
                        const now = new Date();
                        const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
                        if (mode === "back") {
                          // A saída recua: a hora vale para a chegada nesta parada.
                          const day = prev.dateTime?.slice(0, 10) ?? today;
                          return { ...prev, arriveAtStop: id, arriveMode: "back", arriveAtTime: null, timeMode: "arrive", dateTime: `${day}T${time}` };
                        }
                        // A saída fica: a hora é depois dela (no dia seguinte, se já passou).
                        const departure = prev.timeMode === "depart" && prev.dateTime ? prev.dateTime : null;
                        const departMs = departure ? new Date(departure).getTime() : now.getTime();
                        const day = departure?.slice(0, 10) ?? today;
                        let at = `${day}T${time}`;
                        if (new Date(at).getTime() <= departMs) {
                          const next = new Date(new Date(`${day}T00:00`).getTime() + 26 * 3600_000);
                          at = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${time}`;
                        }
                        return {
                          ...prev,
                          arriveAtStop: id,
                          arriveMode: "fixed",
                          arriveAtTime: at,
                          timeMode: "depart",
                          dateTime: departure,
                        };
                      })
                    }
                    stops={stops}
                    legs={listLegs}
                    locks={locks}
                    showLegColors={streetLegs !== null}
                    breaks={breaks}
                    onMoveRow={handleMoveRow}
                    onBreakChange={setBreakMinutes}
                    onRemoveBreak={removeBreak}
                    onToggleLock={handleToggleLock}
                    onRemove={removeStop}
                    onDwellChange={setDwell}
                    doneIds={doneIds}
                    onToggleDone={toggleDone}
                  />
                </>
              )}

              {fixedDeadline && serverPlan?.deadline && (
                <p
                  role="status"
                  className={`rounded-md border px-2.5 py-2 text-xs ${
                    serverPlan.deadline.late
                      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                      : "border-line bg-sunken text-ink-2"
                  }`}
                >
                  {serverPlan.deadline.late
                    ? t.stops.arriveLate(
                        serverPlan.deadline.position + 1,
                        formatTime(new Date(new Date(serverPlan.departAt).getTime() + serverPlan.deadline.arriveSeconds * 1000)),
                      )
                    : t.stops.arriveOk(
                        serverPlan.deadline.position + 1,
                        serverPlan.deadline.slackSeconds >= 60 ? t.stops.arriveSlack(Math.round(serverPlan.deadline.slackSeconds / 60)) : "",
                      )}
                </p>
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

              <button
                type="button"
                onClick={() => (start && legCount > 0 ? setBreakDialog(true) : notify(t.breaks.noLegs))}
                className="focus-ring flex items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-compact font-medium text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink motion-reduce:transition-none"
              >
                <CupIcon />+ {t.breaks.addButton}
              </button>
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
              sharePath={sharePath}
              start={start}
              stops={stops}
              doneIds={doneIds}
              finalPlace={finalPlace}
              roundTrip={endSame}
              plan={plan}
              isMobile={!isDesktop}
              avoidTolls={settings.avoidTolls}
              onNotify={notify}
              onDepartureReport={() => void makeDepartureReport()}
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
                    {plan && (dwellTotal > 0 || plan.breakSeconds > 0) && (
                      <>
                        {": "}
                        {[
                          t.summary.parts.driving(formatDuration(plan.driveSeconds)),
                          dwellTotal > 0 ? t.summary.parts.atStops(formatDuration(dwellTotal)) : null,
                          plan.breakSeconds > 0 ? t.summary.parts.resting(formatDuration(plan.breakSeconds)) : null,
                        ]
                          .filter(Boolean)
                          .join(" + ")}
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
                  <dd className="text-md font-semibold text-ink">
                    {/* Na viagem começada no meio do caminho, a saída é deduzida (aproximada). */}
                    {tripActive && tripDepartAt !== null
                      ? `≈ ${formatTime(new Date(tripDepartAt))}`
                      : plan
                        ? formatTime(plan.departAt)
                        : "—"}
                  </dd>
                </div>
                <div className="border-l border-line px-3 py-2">
                  <dt className="text-2xs font-medium text-muted">{t.summary.arrival}</dt>
                  <dd className="text-md font-semibold text-ink">
                    {tripActive && live ? formatTimeWithDay(live.endArriveAt, live.startedAt) : arriveText}
                  </dd>
                </div>
                <div className="col-span-2 border-t border-line px-3 py-2">
                  <dt className="text-2xs font-medium text-muted">{t.summary.distance}</dt>
                  <dd className="text-md font-semibold text-ink">{distanceText}</dd>
                </div>
              </dl>

              {isCompact && trip !== null ? null : tripPanel}

              <div className="flex items-start justify-between gap-2">
                <p className="text-compact text-ink-2">
                  {t.summary.typed(formatDuration(typedSeconds + dwellTotal + (plan?.breakSeconds ?? 0)))}{" "}
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
                  {(aiTier !== "local" || aiLoading) && <AiBadge />}
                  {/* O símbolo já diz que é da IA: com o comentário pronto, não precisa de texto. */}
                  {aiLoading ? (
                    <span>{t.ai.loading}</span>
                  ) : aiOutcome?.review ? null : (
                    <Badge>{stops.length < 2 ? t.ai.localOnly : t.ai.noAi}</Badge>
                  )}
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
  const cardOptions = (id: BlockId, extra: Partial<BlockOptions> & { wide?: boolean } = {}): BlockOptions => ({
    variant: "card",
    headerDrag: blockDrag.headerDrag(id),
    blockRef: blockDrag.register(id),
    className: `${extra.wide ? "w-[28rem]" : "w-[23rem]"} ${extra.className ?? ""}`,
    ...(extra.style ? { style: extra.style } : {}),
    ...(extra.collapseTo ? { collapseTo: extra.collapseTo } : {}),
  });
  /** Lugar reservado na coluna enquanto um bloco é arrastado para ela (o "ímã"). */
  const placeholder = (wide: boolean) => drag && (
    <div
      key="lugar"
      aria-hidden="true"
      className={`${wide ? "w-[28rem]" : "w-[23rem]"} shrink-0 rounded-xl border-2 border-dashed border-accent/60 bg-accent/5`}
      style={{ height: Math.min(drag.rect.height, 160) }}
    />
  );
  const column = (side: "left" | "right") => {
    const ids = layoutBlocks[side].filter((id) => id !== drag?.id);
    const items: ReactNode[] = ids.map((id) => (
      <Fragment key={id}>{blocks[id](cardOptions(id, { className: "shrink-0", wide: side === "right" }))}</Fragment>
    ));
    if (drag?.target.kind === "dock" && drag.target.side === side) {
      items.splice(Math.min(drag.target.index, items.length), 0, placeholder(side === "right"));
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
        points={mapPoints}
        path={mapPath}
        streetLegs={mapStreetLegs}
        onLegClick={(leg, lat, lng) => (!isDesktop && sheetOpen ? setSheetOpen(false) : handleLegClick(leg, lat, lng))}
        selectedLeg={info?.leg ?? null}
        doneLegs={tripActive ? [] : doneLegs}
        legColors={mapLegColors}
        legLabels={mapLegLabels}
        captureRef={captureRef}
        driving={moving}
        overview={overviewPoints}
        me={meOnMap}
        follow={gpsOn}
        tracking={tripActive}
        headingUp={headingUp}
        compact={isCompact}
        navHeader={isCompact && !!tripHeader}
        rotateControl={tripActive ? { pressed: headingUp, onToggle: () => setHeadingUp((on) => !on) } : null}
        columnInsets={columnInsets}
        fitVersion={fitVersion}
        onNewRoute={trip === null ? () => setNewRouteAsk(true) : undefined}
        onShare={!isDesktop && trip === null && sharePath ? shareRouteLink : undefined}
        // O aviso só aparece se a rota pelas ruas realmente falhou (não enquanto calcula nem na viagem).
        showApproximate={planStatus === "failed" && !tripActive}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        layout={layout}
        fallbackStyleUrl={fallbackStyleUrl}
        onMapClick={(lat, lng) => {
          // Celular com a bandeja aberta: o toque no mapa só recolhe a bandeja.
          if (!isDesktop && sheetOpen) return setSheetOpen(false);
          openInfo(lat, lng);
        }}
        onMapContextMenu={handleContextMenu}
        onPointClick={(id) => (!isDesktop && sheetOpen ? setSheetOpen(false) : handlePointClick(id))}
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
        className={`fixed inset-x-0 bottom-0 z-10 flex max-h-[62dvh] flex-col overflow-hidden rounded-t-2xl bg-surface shadow-sheet ${
          // Em viagem, a bandeja se destaca (de longe, com o celular no suporte): borda e alça na cor de destaque.
          tripActive ? "border-t-[3px] border-accent shadow-[0_-10px_28px_rgb(0_0_0/0.35)]" : "border-t border-line"
        }`}
      >
        <button
          type="button"
          aria-expanded={sheetOpen}
          aria-controls="hud-conteudo"
          onClick={() => setSheetOpen((open) => !open)}
          className={`focus-ring flex w-full shrink-0 flex-col items-center outline-offset-[-2px] ${
            tripActive ? "gap-2.5 px-4 pb-4 pt-3" : "gap-2 px-4 pb-3 pt-2"
          }`}
        >
          <span
            aria-hidden="true"
            className={`rounded-full ${tripActive ? "h-1.5 w-16 bg-accent" : "h-1 w-9 bg-line-strong"}`}
          />
          <span
            className={`flex w-full items-center justify-between gap-2 font-semibold text-ink ${
              tripActive ? "text-base font-bold" : "text-sm"
            }`}
          >
            <span className="truncate">{handleSummary}</span>
            <span className={`rotate-180 ${tripActive ? "origin-center scale-150 text-accent" : "text-faint"}`}>
              <Chevron open={sheetOpen} />
            </span>
          </span>
          <span className="sr-only">{sheetOpen ? t.app.closePanel : t.app.openPanel}</span>
        </button>

        <div
          id="hud-conteudo"
          inert={!sheetOpen}
          onPointerDownCapture={() => (sheetTouchRef.current = nowMs())}
          onTouchMoveCapture={() => (sheetTouchRef.current = nowMs())}
          onKeyDownCapture={() => (sheetTouchRef.current = nowMs())}
          onScrollCapture={() => (sheetTouchRef.current = nowMs())}
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

      <NewRouteDialog
        open={newRouteAsk}
        onNo={() => setNewRouteAsk(false)}
        onYes={() => {
          setNewRouteAsk(false);
          // Encerra a viagem e começa do zero (apaga a rota; as configurações ficam).
          startFresh();
        }}
      />

      <LeaveStopDialog
        stopName={leaveAsk}
        onYes={() => {
          setLeaveAsk(null);
          resumeTrip();
        }}
        onNo={() => {
          // Estava manobrando: pergunta de novo só depois de mais 1 km.
          leaveAtRef.current = lastLeaveMetersRef.current + 1000;
          setLeaveAsk(null);
        }}
      />

      <TripWarningDialog open={tripWarning} onAccept={beginTrip} onCancel={() => setTripWarning(false)} />

      <TripStatsDialog
        open={statsOpen}
        stats={tripStats}
        reportTrip={reportDraft}
        locale={locale}
        theme={theme}
        fontSize={settings.fontSize}
        onClose={() => setStatsOpen(false)}
        onFinalReport={downloadFinalReport}
      />

      {resumeAsk && (
        <ResumeDialog summary={resumeAsk} onContinue={() => setResumeAsk(null)} onFresh={startFresh} />
      )}

      {breakDialog && (
        <BreakDialog
          options={breakOptions}
          onConfirm={(minutes, after) => {
            addBreak(minutes, after);
            setBreakDialog(false);
          }}
          onCancel={() => setBreakDialog(false)}
        />
      )}

      {tripHeader}

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
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
              className="focus-ring -my-0.5 rounded px-1.5 py-0.5 font-semibold text-on-ink hover:bg-on-ink/15"
            >
              {t.common.undo}
            </button>
          )}
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
