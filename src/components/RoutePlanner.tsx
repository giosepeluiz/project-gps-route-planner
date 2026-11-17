"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ActionsPanel from "./ActionsPanel";
import CollapsibleCard, { Chevron, type HeaderDrag } from "./CollapsibleCard";
import MapView, { type MapLayout, type MapPoint } from "./MapView";
import PlaceField, { inputClass } from "./PlaceField";
import PlacePopup from "./PlacePopup";
import AboutDialog from "./AboutDialog";
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
  pluralStops,
  toLocalInputValue,
} from "@/lib/format";
import { useCurrentMinute, useLocalStorageState, useMediaQuery } from "@/lib/hooks";
import {
  fetchParsedPlaces,
  fetchReview,
  judgeSuggestion,
  locksFromSuggestion,
  reviewRequestBody,
  TIER_LABEL,
  type ReviewOutcome,
} from "@/lib/ai-client";
import { legColor } from "@/lib/leg-colors";
import { cleanLocks, moveStop, removeFromLocks, toggleLock } from "@/lib/locks";
import { MOCK_START, MOCK_TYPED_STOPS } from "@/lib/mock-data";
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
import {
  addStop,
  isApproximate,
  isDuplicate,
  MAX_STOPS,
  MSG_APPROX,
  MSG_DUPLICATE,
  MSG_NOT_FOUND,
} from "@/lib/stops";
import { MAX_DWELL_MINUTES, type LegTimeFn, type Place, type TimeMode } from "@/lib/types";

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

/** Último estado da rota, salvo em localStorage. */
interface RouteState {
  start: Place;
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
    <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-px text-2xs font-semibold text-ink-2">
      {children}
    </span>
  );
}

export default function RoutePlanner({ fallbackStyleUrl }: { fallbackStyleUrl: string | null }) {
  const [route, setRoute] = useLocalStorageState(ROUTE_KEY, ROUTE_DEFAULT, isRouteState);
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
  const [aboutOpen, setAboutOpen] = useState(false);
  /** Sobe quando os blocos mudam de lugar ou de tamanho de texto: o mapa reenquadra a rota. */
  const [fitVersion, setFitVersion] = useState(0);
  const setSettings = (next: Settings) => {
    if (next.fontSize !== settings.fontSize || JSON.stringify(next.layout) !== JSON.stringify(settings.layout)) {
      setFitVersion((v) => v + 1);
    }
    setStoredSettings(next);
  };
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
  const tryAddStop = (newPlace: Place): string | null => {
    // Toda parada nova recebe a permanência padrão das configurações.
    const place = { ...newPlace, dwellMinutes: settings.defaultDwellMinutes };
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

  // Local digitado como coordenadas (ou link com coordenadas): troca o rótulo
  // pelo nome da zona (bairro ou freguesia, e a cidade), para ficar fácil de
  // reconhecer na lista, no Resumo e no comentário da IA. Uma tentativa por local.
  const zoneTried = useRef(new Set<string>());
  useEffect(() => {
    const places = [route.start, ...route.stops, ...(route.end ? [route.end] : [])];
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
          start: rename(prev.start),
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
      notify(`${place?.label ?? "Parada"} concluída.`);
    }
  };

  /** Trechos concluídos no mapa: o trecho i chega na parada i. */
  const doneLegs = useMemo(
    () => stops.flatMap((s, i) => (doneIds.has(s.id) ? [i] : [])),
    [stops, doneIds],
  );

  /** Aceita a ordem da IA: cada parada fica travada na posição sugerida (dá para destravar depois). */
  const acceptSuggestion = (suggestedStops: readonly number[]) => {
    const next = locksFromSuggestion(displayedIds, suggestedStops);
    if (!next) {
      notify("A sugestão não vale mais para esta lista de paradas.");
      return;
    }
    setRoute((prev) => ({ ...prev, locks: next }));
    notify(`Sugestão aceita: ${pluralStops(displayedIds.length)} travadas na ordem da IA.`);
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
      <div className="flex w-56 max-w-full flex-col gap-1 pr-4 text-sm text-ink">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          <span aria-hidden="true" className="h-2 w-5 rounded-full" style={{ backgroundColor: legColor(info.leg) }} />
          Trecho {info.leg + 1}
        </p>
        <p className="font-semibold">
          {from.label} → {to.label}
        </p>
        <p className="text-base font-semibold">
          {formatKm(street.meters)} · {formatDuration(street.seconds)}
        </p>
        <p className="text-xs text-muted">
          Distância e tempo médio pelas ruas. Fonte: {serverPlan?.streetSource}.
        </p>
        {planned && !planned.estimated && Math.abs(planned.seconds - street.seconds) >= 60 && (
          <p className="text-xs text-muted">Com o trânsito previsto: {formatDuration(planned.seconds)}.</p>
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
      reviewRequestBody(
        sequence.map((p) => p.label),
        serverPlan.legSeconds,
        endSame,
        lockCount,
        stops.length,
        serverPlan.exact,
      ),
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
      suggestionLocks
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
    const all = [start, ...typedStops, ...(end ? [end] : [])];
    const from = all.find((p) => p.id === outcome.fromId);
    const to = all.find((p) => p.id === outcome.toId);
    const where = from && to ? `entre ${from.label} e ${to.label}` : "ligando todos os locais";
    return `Não existe caminho de carro ${where}. Balsas não contam; pontes e túneis, sim.`;
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
  const handleSummary = `${totalText} · ${pluralStops(stops.length)} · chega ${arriveText}`;
  const startEndSummary = endSame
    ? `${start.label} · ida e volta`
    : end
      ? `${start.label} → ${end.label}`
      : `${start.label} · termina na última parada`;
  const dwellTotal = plan?.dwellSeconds ?? 0;
  // A ordem só muda o tempo dirigindo; a permanência é a mesma em qualquer ordem.
  const savedMinutes = plan ? Math.round((typedSeconds - plan.driveSeconds) / 60) : 0;
  const dateValue = dateTime ?? (anchor ? toLocalInputValue(anchor) : "");

  // Blocos do HUD. Onde cada um aparece vem das configurações (arrastar e soltar).
  const blocks: Record<BlockId, (options: BlockOptions) => ReactNode> = {
    inicio: (options) => (
          <CollapsibleCard
            id="bloco-inicio"
            title="Início e fim"
            summary={startEndSummary}
            open={isOpen("inicio")}
            onToggle={() => toggle("inicio")}
            {...options}
          >
            <div className="flex flex-col gap-3">
              <PlaceField
                label="Início"
                value={start.label}
                placeholder="Endereço, coordenadas ou link"
                onSubmit={(text) => submitFixed(text, "start")}
                suggest={suggestAddresses}
                onPick={(s) => setFixed("start", placeFromSuggestion(s))}
              />

              <div className="flex items-center justify-between gap-3">
                <span id={switchId} className="text-sm text-ink-2">
                  O local de fim é o mesmo do início
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
                  label="Fim"
                  value={end?.label ?? ""}
                  placeholder="Opcional: endereço, coordenadas ou link"
                  onSubmit={(text) => submitFixed(text, "end")}
                  suggest={suggestAddresses}
                  onPick={(s) => setFixed("end", placeFromSuggestion(s))}
                />
              )}

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-ink-2">
                  Horário
                </legend>
                <div className="mb-2 grid grid-cols-2 gap-0.5 rounded-lg bg-sunken p-0.5">
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
                    className="focus-ring shrink-0 rounded-lg border border-line px-3 text-compact font-medium text-ink-2 transition-colors hover:bg-hover disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
                  >
                    Agora
                  </button>
                </div>
              </fieldset>
            </div>
          </CollapsibleCard>
    ),
    paradas: (options) => (
          <CollapsibleCard
            id="bloco-paradas"
            title={`Paradas (${stops.length}/${MAX_STOPS})`}
            summary={pluralStops(stops.length)}
            open={isOpen("paradas")}
            onToggle={() => toggle("paradas")}
            {...options}
          >
            <div className="flex flex-col gap-3">
              {stops.length === 0 ? (
                <p className="text-sm text-muted">
                  Nenhuma parada ainda. Adicione abaixo ou clique no mapa.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted">
                    Arraste pela alça para reposicionar: o local solto fica travado ali (cadeado). O
                    relógio define quanto tempo você fica em cada parada. Toque no número para marcar a
                    parada como concluída.
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
                  {MSG_APPROX}
                </p>
              )}

              <PlaceField
                label="Adicionar parada"
                value=""
                placeholder="Endereço, coordenadas ou link"
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
            title="Abrir e compartilhar"
            summary="Google Maps, navegar, copiar"
            open={isOpen("acoes")}
            onToggle={() => toggle("acoes")}
            {...options}
          >
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
          </CollapsibleCard>
    ),
    resumo: (options) => (
          <CollapsibleCard
            id="bloco-resumo"
            title="Resumo"
            summary={`${totalText} · chega ${arriveText}`}
            open={isOpen("resumo")}
            onToggle={() => toggle("resumo")}
            {...options}
          >
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-display font-semibold leading-none tracking-[-0.02em] text-ink">{totalText}</p>
                  <p className="mt-1.5 text-xs text-muted">
                    {endSame ? "Tempo total, ida e volta" : "Tempo total"}
                    {plan && dwellTotal > 0 && (
                      <>
                        {": "}
                        {formatDuration(plan.driveSeconds)} dirigindo + {formatDuration(dwellTotal)} nas paradas
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
                  <dt className="text-2xs font-medium text-muted">Saída</dt>
                  <dd className="text-md font-semibold text-ink">{plan ? formatTime(plan.departAt) : "—"}</dd>
                </div>
                <div className="border-l border-line px-3 py-2">
                  <dt className="text-2xs font-medium text-muted">Chegada</dt>
                  <dd className="text-md font-semibold text-ink">{arriveText}</dd>
                </div>
              </dl>

              <p className="text-compact text-ink-2">
                Na ordem digitada: {formatDuration(typedSeconds + dwellTotal)}.{" "}
                {savedMinutes > 0 ? (
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">
                    Economia de {savedMinutes} min.
                  </span>
                ) : (
                  "A ordem atual não é mais rápida que a digitada."
                )}
              </p>

              {lockCount > 0 && plan && (
                <p className="text-compact text-ink-2">
                  {lockCount === 1 ? "1 local travado." : `${lockCount} locais travados.`}{" "}
                  {plan.driveSeconds - bestSeconds >= 60 ? (
                    <span className="font-medium text-amber-800 dark:text-amber-300">
                      Sem travas, a rota levaria {formatDuration(bestSeconds + dwellTotal)} (
                      {Math.round((plan.driveSeconds - bestSeconds) / 60)} min a menos).
                    </span>
                  ) : (
                    "Mesmo assim, esta é a ordem mais rápida."
                  )}
                </p>
              )}

              <ul className="flex flex-col gap-1 text-xs text-muted">
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

              <div className="flex flex-col gap-1.5 border-t border-line pt-3" aria-live="polite">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>
                    {(aiTier !== "local" || aiLoading) && <Sparkles />}
                    {aiLoading ? "IA" : TIER_LABEL[aiTier]}
                  </Badge>
                  {aiLoading
                    ? "Consultando a IA…"
                    : aiOutcome?.review
                      ? "Comentário da IA"
                      : stops.length < 2
                        ? "Algoritmo local"
                        : "Algoritmo local (nenhuma IA respondeu)"}
                </p>
                {aiOutcome?.review && (
                  <>
                    <p className="text-compact leading-relaxed text-ink-2">{aiOutcome.review.explanation}</p>
                    {/* Só a sugestão com ordem é conferível; ela aparece depois de passar pelos tempos reais. */}
                    {suggestedStops && !checked && (
                      <p className="text-xs text-muted">Conferindo a sugestão da IA com os tempos reais…</p>
                    )}
                    {suggestedStops && verdict?.faster && (
                      <>
                        {aiOutcome.review.backtracking && (
                          <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            A IA viu um vai-e-volta nesta ordem.
                          </p>
                        )}
                        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                          <p className="text-xs leading-relaxed text-ink-2">
                            <span className="font-semibold text-ink">Sugestão da IA:</span> {aiOutcome.review.suggestion}
                          </p>
                          <p className="text-2xs text-muted">
                            Nova ordem: {suggestedStops.map((from) => stops[from]?.label).join(" → ")}
                          </p>
                          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            Conferido com os tempos reais: {formatDuration(-verdict.diffSeconds)} mais rápida.
                          </p>
                          <button
                            type="button"
                            onClick={() => acceptSuggestion(suggestedStops)}
                            className="focus-ring self-start rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-on-ink hover:bg-ink/85"
                          >
                            Aceitar sugestão
                          </button>
                        </div>
                      </>
                    )}
                    {suggestedStops && verdict && !verdict.faster && (
                      <p className="text-xs text-muted">
                        A IA sugeriu outra ordem, mas pelos tempos reais ela{" "}
                        {verdict.diffSeconds >= 60
                          ? `levaria ${formatDuration(verdict.diffSeconds)} a mais`
                          : "não seria mais rápida"}
                        . Ficou a ordem atual.
                      </p>
                    )}
                    {suggestedStops && checked && checked.kind !== "ok" && (
                      <p className="text-xs text-muted">
                        A IA sugeriu outra ordem, mas não deu para conferir com os tempos reais. Ficou a ordem atual.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
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
    <main className="relative h-dvh w-full overflow-hidden">
      <h1 className="sr-only">Planejador de rotas</h1>

      <MapView
        points={points}
        path={path}
        streetLegs={streetLegs}
        onLegClick={handleLegClick}
        selectedLeg={info?.leg ?? null}
        doneLegs={doneLegs}
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
                  className="focus-ring self-start rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
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

      {isDesktop ? (
        // Desktop: cada bloco é um cartão sobre o mapa, arrastável pelo título.
        <aside aria-label="Planejamento da rota">
          {column("left")}
          {column("right")}
          {freeBlocks}
          {draggedBlock}
        </aside>
      ) : (
      <aside
        aria-label="Planejamento da rota"
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
          <span className="sr-only">{sheetOpen ? "Recolher painel" : "Abrir painel"}</span>
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
      />

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
              Desfazer
            </button>
          )}
        </div>
      )}
    </main>
  );
}
