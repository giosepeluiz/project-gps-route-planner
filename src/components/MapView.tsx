"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useT } from "./I18nProvider";
import { DONE_LEG_COLOR, legColor } from "@/lib/leg-colors";
import { overlayPadding } from "@/lib/map-padding";
import { angleDelta, lerpAngle, projectOnLine, remainingLine, type LngLat, type Projection } from "@/lib/route-progress";
import { snapRadius } from "@/lib/trip";
import { MAP_ATTRIBUTION, PRIMARY_STYLE_URL } from "@/lib/map-style";

type MapLibre = typeof import("maplibre-gl");

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  kind: "start" | "end" | "stop";
  /** Texto do pin: "A", "B" ou o número da parada. */
  badge: string;
  title: string;
}

/** Leitura do GPS mostrada no mapa. */
export interface MePosition {
  lat: number;
  lng: number;
  /** Direção do carro (graus), quando se sabe. */
  heading: number | null;
  accuracy: number;
  /** Momento da leitura (ms). */
  at: number;
}

/** Quanto do mapa está coberto pelo HUD, para o enquadramento da rota. */
export type MapLayout = "desktop" | "sheet-open" | "sheet-closed";

interface MapViewProps {
  points: MapPoint[];
  /** Retas entre os pontos, em [lng, lat]: a linha azul pontilhada. */
  path: [number, number][];
  /** Rota pelas ruas, um trecho por item: a linha colorida. null quando não há geometria. */
  streetLegs: [number, number][][] | null;
  /** Clique em um trecho da linha colorida. */
  onLegClick: (index: number, lat: number, lng: number) => void;
  /** Trecho com o balão aberto: fica em destaque e os outros, semitransparentes. */
  selectedLeg: number | null;
  /** Trechos já concluídos (índices): aparecem em cinza. */
  doneLegs: readonly number[];
  /** Cor de cada trecho (na viagem, os trechos que faltam mantêm a cor da parada). */
  legColors?: readonly string[];
  /** Posição atual pelo GPS (durante a viagem), ou null. */
  me?: MePosition | null;
  /** Com a viagem em andamento, o mapa acompanha a posição atual (em 3D). */
  follow?: boolean;
  /**
   * Viagem ativa: a seta "gruda" no primeiro trecho da linha colorida e a parte
   * já percorrida some, acompanhando a seta.
   */
  tracking?: boolean;
  /** Mapa girando com a direção da viagem (senão, norte para cima). */
  headingUp?: boolean;
  /** Celular ou tablet: na viagem, a câmera chega bem perto da seta. */
  compact?: boolean;
  /** Viagem no celular/tablet: o cabeçalho ocupa o topo e os botões descem para baixo dele. */
  navHeader?: boolean;
  /** Botão de girar o mapa junto das configurações (só na viagem). */
  rotateControl?: { pressed: boolean; onToggle: () => void } | null;
  layout: MapLayout;
  /**
   * Largura (px) das colunas de blocos grudadas em cada borda, no desktop. Os
   * controles do mapa ficam ao lado delas, nunca embaixo.
   */
  columnInsets: { left: number; right: number };
  /**
   * Muda quando os blocos mudam de lugar (fim de um arrasto). A rota é
   * reenquadrada só nessas horas e quando os pontos mudam, nunca porque um
   * bloco cresceu (ex.: chegou o comentário da IA).
   */
  fitVersion: number;
  /** Abre a tela de configurações (botão junto do zoom). */
  onOpenSettings: () => void;
  /** Abre a tela Sobre (botão "?"). */
  onOpenAbout: () => void;
  fallbackStyleUrl: string | null;
  /** Clique esquerdo no mapa: mostra a informação do local. */
  onMapClick: (lat: number, lng: number) => void;
  /** Clique direito (ou toque longo): adiciona um pin. */
  onMapContextMenu: (lat: number, lng: number) => void;
  /** Clique em um pin existente. */
  onPointClick: (id: string) => void;
  /** Área visível: [oeste, sul, leste, norte]. */
  onBoundsChange: (bbox: [number, number, number, number]) => void;
  /** Balão de informação aberto no mapa (o conteúdo vem em `children`). */
  popupAt: { lat: number; lng: number } | null;
  onPopupClose: () => void;
  children?: ReactNode;
}

const STRAIGHT_SOURCE = "rota-reta";
const STRAIGHT_LAYER = "rota-reta-linha";
const STRAIGHT_COLOR = "#2563eb";
const STREET_SOURCE = "rota-ruas";
const STREET_CASING = "rota-ruas-borda";
const STREET_LAYER = "rota-ruas-linha";
const DESKTOP_QUERY = "(min-width: 768px)";
/** Inclinação da câmera na viagem (visão 3D, como nos GPS). */
const NAV_PITCH = 55;
/** Zoom da viagem: bem perto no celular e no tablet (como no Waze), um pouco mais aberto no computador. */
const NAV_ZOOM_COMPACT = 18.6;
const NAV_ZOOM_DESKTOP = 16.5;
/** Quanto a câmera anda até o zoom e a inclinação da viagem a cada quadro (aproximação suave). */
const CAMERA_EASE = 0.045;

/** Tamanho da seta conforme o zoom: pequena com o mapa aberto, grande bem perto. */
const arrowSize = (zoom: number) => Math.round(Math.min(76, Math.max(30, 30 + (zoom - 13) * 8)));

/**
 * Espessura da linha da rota conforme o zoom (o MapLibre interpola sozinho,
 * acompanhando a aproximação da câmera).
 */
const STREET_WIDTH: ExpressionSpecification = ["interpolate", ["exponential", 1.6], ["zoom"], 10, 4, 14, 6, 16, 10, 18, 18, 20, 30];
const CASING_WIDTH: ExpressionSpecification = ["interpolate", ["exponential", 1.6], ["zoom"], 10, 7, 14, 9, 16, 15, 18, 26, 20, 42];
/** Depois de a pessoa arrastar o mapa na viagem, a câmera espera antes de voltar a seguir. */
const FOLLOW_PAUSE_MS = 8_000;

const ARROW_SVG =
  '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><defs><filter id="sombra-seta" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#000" flood-opacity=".35"/></filter></defs><circle cx="20" cy="20" r="17" fill="#1a73e8" fill-opacity=".16"/><path d="M20 6.5 L30.5 31 L20 25.4 L9.5 31 Z" fill="#1a73e8" stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round" filter="url(#sombra-seta)"/></svg>';

const ROTATE_ICON =
  '<svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.25"/><path d="M10 4.6l2.4 6.2L10 9.6l-2.4 1.2z" fill="currentColor"/></svg>';

type StreetsData = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { index: number; color: string };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
};

/**
 * Na viagem, o primeiro trecho começa onde o carro está: projeta a posição na
 * linha e, se estiver perto o bastante, corta o pedaço já percorrido.
 */
function withProgress(
  streets: StreetsData,
  position: LngLat | null,
  accuracy: number,
): { data: StreetsData; snapped: Projection | null } {
  const first = streets.features[0];
  if (!position || !first) return { data: streets, snapped: null };
  const projection = projectOnLine(position, first.geometry.coordinates);
  if (!projection || projection.distanceM > snapRadius(accuracy)) return { data: streets, snapped: null };
  return {
    data: {
      ...streets,
      features: [
        { ...first, geometry: { ...first.geometry, coordinates: remainingLine(first.geometry.coordinates, projection) } },
        ...streets.features.slice(1),
      ],
    },
    snapped: projection,
  };
}

interface CtrlButton {
  title: string;
  label: string;
  /** SVG do ícone (traço, herdando a cor do texto). */
  icon: string;
  onClick: () => void;
  /** Abre um diálogo (anunciado pelos leitores de tela). */
  opensDialog?: boolean;
  /** Botão liga/desliga: aria-pressed e destaque. */
  pressed?: boolean;
}

const GEAR_ICON =
  '<svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>';
const HELP_ICON =
  '<svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.25"/><path d="M7.9 7.6a2.2 2.2 0 014.25.75c0 1.5-2.15 1.9-2.15 3.15"/><circle cx="10" cy="14.2" r=".35" fill="currentColor"/></svg>';

/** Grupo de botões no mesmo visual dos controles do MapLibre (configurações e ajuda). */
function createButtonsControl(buttons: CtrlButton[]) {
  let container: HTMLDivElement | null = null;
  return {
    onAdd() {
      container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";
      for (const spec of buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rotas-ctrl-button";
        button.title = spec.title;
        button.setAttribute("aria-label", spec.label);
        if (spec.opensDialog) button.setAttribute("aria-haspopup", "dialog");
        if (spec.pressed !== undefined) {
          button.setAttribute("aria-pressed", String(spec.pressed));
          if (spec.pressed) button.classList.add("rotas-ctrl-on");
        }
        button.innerHTML = spec.icon;
        button.addEventListener("click", () => spec.onClick());
        container.append(button);
      }
      return container;
    },
    onRemove() {
      container?.remove();
      container = null;
    },
  };
}

/** Margens do enquadramento a partir dos blocos sobre o mapa ([data-map-overlay]). */
function measuredPadding(container: HTMLElement) {
  const overlays = [...document.querySelectorAll<HTMLElement>("[data-map-overlay]")].map((el) =>
    el.getBoundingClientRect(),
  );
  return overlayPadding(container.getBoundingClientRect(), overlays);
}

/** Margens do espaço livre do mapa (fora do HUD), limitadas a 60% em cada eixo. */
function routePadding(map: MapLibreMap, layout: MapLayout) {
  const height = map.getContainer().clientHeight;
  const padding =
    layout === "desktop"
      ? measuredPadding(map.getContainer())
      : {
          top: 72,
          left: 40,
          right: 40,
          bottom: layout === "sheet-open" ? Math.round(height * 0.6) + 24 : 112,
        };
  // Em telas pequenas o HUD pode cobrir quase tudo: limita as margens a 60% do
  // mapa, senão o enquadramento não tem solução (e o MapLibre lança erro).
  const width = map.getContainer().clientWidth;
  const horizontal = padding.left + padding.right;
  const vertical = padding.top + padding.bottom;
  const scaleX = horizontal > width * 0.6 ? (width * 0.6) / horizontal : 1;
  const scaleY = vertical > height * 0.6 ? (height * 0.6) / vertical : 1;
  padding.left *= scaleX;
  padding.right *= scaleX;
  padding.top *= scaleY;
  padding.bottom *= scaleY;
  return padding;
}

export default function MapView({
  points,
  path,
  streetLegs,
  onLegClick,
  selectedLeg,
  doneLegs,
  legColors,
  me = null,
  follow = false,
  tracking = false,
  headingUp = false,
  compact = false,
  rotateControl = null,
  navHeader = false,
  layout,
  columnInsets,
  fitVersion,
  onOpenSettings,
  onOpenAbout,
  fallbackStyleUrl,
  onMapClick,
  onMapContextMenu,
  onPointClick,
  onBoundsChange,
  popupAt,
  onPopupClose,
  children,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const meMarkerRef = useRef<Marker | null>(null);
  /** Linha colorida completa (sem o corte do trecho percorrido). */
  const streetsRef = useRef<StreetsData | null>(null);
  /** Posição e direção que a seta mostra agora (animadas). */
  const shownRef = useRef<{ lng: number; lat: number; bearing: number } | null>(null);
  /** Posição do GPS (sem grudar na linha) no quadro atual da animação. */
  const rawRef = useRef<LngLat | null>(null);
  const lastFixAtRef = useRef<number | null>(null);
  const followPauseRef = useRef(0);
  /** Zoom que a câmera busca na viagem; null depois que a pessoa ajusta o zoom com os dedos. */
  const zoomTargetRef = useRef<number | null>(null);
  const followRef = useRef(follow);
  const headingUpRef = useRef(headingUp);
  const trackingRef = useRef(tracking);
  useEffect(() => {
    followRef.current = follow;
    headingUpRef.current = headingUp;
    trackingRef.current = tracking;
  });
  /** Muda a cada estilo carregado, para redesenhar a rota depois de uma troca de estilo. */
  const [styleVersion, setStyleVersion] = useState(0);
  const [size, setSize] = useState("");
  const [status, setStatus] = useState<"loading" | "ok" | "fallback" | "error">("loading");
  /** Elemento do balão, preenchido pelo React via portal. */
  const [popupEl] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );

  const handleClick = useEffectEvent((lat: number, lng: number) => onMapClick(lat, lng));
  const handleLegClick = useEffectEvent((index: number, lat: number, lng: number) =>
    onLegClick(index, lat, lng),
  );
  const handleContextMenu = useEffectEvent((lat: number, lng: number) => onMapContextMenu(lat, lng));
  const handlePointClick = useEffectEvent((id: string) => onPointClick(id));
  const handlePopupClose = useEffectEvent(() => onPopupClose());
  const t = useT();
  const handleOpenSettings = useEffectEvent(() => onOpenSettings());
  const handleOpenAbout = useEffectEvent(() => onOpenAbout());
  const handleToggleRotate = useEffectEvent(() => rotateControl?.onToggle());
  const hasRotate = rotateControl !== null;
  const rotatePressed = rotateControl?.pressed ?? false;
  const handleBounds = useEffectEvent((map: MapLibreMap) => {
    const b = map.getBounds();
    onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  });

  // Cria o mapa uma única vez.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    void import("maplibre-gl").then((lib) => {
      if (cancelled || !containerRef.current) return;
      libRef.current = lib;
      // O worker é servido de /public (copiado por scripts/copy-maplibre-worker.mjs).
      lib.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${lib.getVersion()}`);

      map = new lib.Map({
        container: containerRef.current,
        style: PRIMARY_STYLE_URL,
        center: [-9.14, 38.71],
        zoom: 10,
        attributionControl: false,
        dragRotate: false,
      });
      mapRef.current = map;

      // Reenquadra a rota quando o tamanho do mapa muda (rotação, redimensionamento).
      map.on("resize", () => {
        const el = map?.getContainer();
        if (el) setSize(`${el.clientWidth}x${el.clientHeight}`);
      });

      let styleLoaded = false;
      let triedFallback = false;

      map.on("style.load", () => {
        styleLoaded = true;
        setStatus(triedFallback ? "fallback" : "ok");
        setStyleVersion((v) => v + 1);
      });

      map.on("error", (event) => {
        // Só interessa a falha do estilo; erros de tiles avulsos não trocam nada.
        if (styleLoaded) return;
        if (!triedFallback && fallbackStyleUrl) {
          triedFallback = true;
          console.warn("Estilo principal do mapa falhou; usando o estilo reserva.", event.error);
          map?.setStyle(fallbackStyleUrl);
          return;
        }
        console.error("Não foi possível carregar o estilo do mapa.", event.error);
        setStatus("error");
      });

      map.on("click", (event) => {
        // Clique na linha colorida (com uma folga de 6 px) mostra os dados do trecho.
        if (map?.getLayer(STREET_LAYER)) {
          const { x, y } = event.point;
          const hits = map.queryRenderedFeatures(
            [
              [x - 6, y - 6],
              [x + 6, y + 6],
            ],
            { layers: [STREET_LAYER] },
          );
          const index = hits[0]?.properties?.index;
          if (typeof index === "number") {
            handleLegClick(index, event.lngLat.lat, event.lngLat.lng);
            return;
          }
        }
        handleClick(event.lngLat.lat, event.lngLat.lng);
      });
      map.on("contextmenu", (event) => {
        event.preventDefault();
        handleContextMenu(event.lngLat.lat, event.lngLat.lng);
      });
      map.on("moveend", () => map && handleBounds(map));
      // Arrastar o mapa na viagem pausa o "seguir" por alguns segundos.
      map.on("dragstart", () => {
        followPauseRef.current = Date.now() + FOLLOW_PAUSE_MS;
      });
      // Zoom feito pela pessoa (pinça, roda, botões) vale até o fim da viagem.
      map.on("zoomstart", (event) => {
        if ((event as { originalEvent?: Event }).originalEvent) zoomTargetRef.current = null;
      });
      // A seta cresce e diminui junto com o zoom.
      map.on("zoom", () => {
        const element = meMarkerRef.current?.getElement();
        if (!element) return;
        const size = `${arrowSize(map?.getZoom() ?? 14)}px`;
        element.style.width = size;
        element.style.height = size;
      });
      map.on("load", () => map && handleBounds(map));
    });

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [fallbackStyleUrl]);

  // Controles do mapa, à direita: configurações e zoom em cima, atribuição embaixo.
  // A atribuição fica sempre aberta; no celular vai para o topo à esquerda, fora da gaveta.
  // Quando há uma coluna de blocos na borda, o CSS (--inset-*) afasta os controles dela.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || styleVersion === 0) return;

    const media = window.matchMedia(DESKTOP_QUERY);
    const settings = createButtonsControl([
      ...(hasRotate
        ? [
            {
              title: rotatePressed ? t.map.rotateOn : t.map.rotateOff,
              label: t.map.rotate,
              icon: ROTATE_ICON,
              pressed: rotatePressed,
              onClick: () => handleToggleRotate(),
            },
          ]
        : []),
      {
        title: t.map.settings,
        label: t.map.openSettings,
        icon: GEAR_ICON,
        opensDialog: true,
        onClick: () => handleOpenSettings(),
      },
      {
        title: t.map.about,
        label: t.map.openAbout,
        icon: HELP_ICON,
        opensDialog: true,
        onClick: () => handleOpenAbout(),
      },
    ]);
    let attribution: InstanceType<MapLibre["AttributionControl"]> | null = null;
    let zoom: InstanceType<MapLibre["NavigationControl"]> | null = null;
    let settingsAdded = false;
    const clear = () => {
      // Se o mapa já foi destruído (desmontagem), os controles foram junto.
      if (mapRef.current !== map) return;
      if (attribution) map.removeControl(attribution);
      if (zoom) map.removeControl(zoom);
      if (settingsAdded) map.removeControl(settings);
      attribution = null;
      zoom = null;
      settingsAdded = false;
    };
    const place = () => {
      clear();
      map.addControl(settings, "top-right");
      settingsAdded = true;
      // Botões de zoom só no desktop; no celular o zoom é por gesto.
      if (media.matches) {
        zoom = new lib.NavigationControl({ showCompass: false });
        map.addControl(zoom, "top-right");
      }
      // Atribuição sempre recolhida no botão "i" (abre com um clique ou toque):
      // embaixo à direita no computador, embaixo à esquerda (acima da gaveta) no celular.
      attribution = new lib.AttributionControl({ compact: true, customAttribution: MAP_ATTRIBUTION });
      map.addControl(attribution, media.matches ? "bottom-right" : "bottom-left");
      map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    };
    place();
    media.addEventListener("change", place);
    return () => {
      media.removeEventListener("change", place);
      clear();
    };
  }, [styleVersion, t, hasRotate, rotatePressed]);

  const doneKey = [...doneLegs].sort((a, b) => a - b).join(",");
  const colorKey = legColors?.join(",") ?? "";

  // Pins e linha da rota.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || styleVersion === 0) return;
    const doneSet = new Set(doneKey ? doneKey.split(",").map(Number) : []);
    const colors = colorKey ? colorKey.split(",") : [];

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = points.map((point) => {
      const element = document.createElement("div");
      element.className = `pin pin-${point.kind}`;
      element.textContent = point.badge;
      element.title = point.title;
      element.setAttribute("role", "button");
      element.tabIndex = 0;
      element.setAttribute("aria-label", t.map.pinAria(point.badge, point.title));
      // O clique no pin não deve contar como clique no mapa.
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        handlePointClick(point.id);
      });
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handlePointClick(point.id);
        }
      });
      element.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      return new lib.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(map);
    });

    // Linha azul pontilhada: retas entre os pontos, sempre presente.
    const straight = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: path },
    };
    // Linha colorida: a rota pelas ruas, um trecho por feature (para o clique saber qual é).
    const streets: StreetsData = {
      type: "FeatureCollection" as const,
      features: (streetLegs ?? []).map((coordinates, index) => ({
        type: "Feature" as const,
        // Trecho concluído fica cinza; os outros, cada um na sua cor.
        properties: { index, color: doneSet.has(index) ? DONE_LEG_COLOR : (colors[index] ?? legColor(index)) },
        geometry: { type: "LineString" as const, coordinates },
      })),
    };

    streetsRef.current = streets;
    const drawn = tracking && rawRef.current ? withProgress(streets, rawRef.current, 30).data : streets;

    const straightSource = map.getSource(STRAIGHT_SOURCE) as GeoJSONSource | undefined;
    if (straightSource) {
      straightSource.setData(straight);
      (map.getSource(STREET_SOURCE) as GeoJSONSource | undefined)?.setData(drawn);
    } else {
      const round = { "line-cap": "round" as const, "line-join": "round" as const };
      map.addSource(STRAIGHT_SOURCE, { type: "geojson", data: straight });
      map.addSource(STREET_SOURCE, { type: "geojson", data: drawn });
      map.addLayer({
        id: STREET_CASING,
        type: "line",
        source: STREET_SOURCE,
        layout: round,
        paint: { "line-color": "#ffffff", "line-width": CASING_WIDTH, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: STREET_LAYER,
        type: "line",
        source: STREET_SOURCE,
        layout: round,
        // Cada trecho tem a sua cor (nenhuma azul, que é a das retas).
        paint: { "line-color": ["get", "color"], "line-width": STREET_WIDTH },
      });
      map.addLayer({
        id: STRAIGHT_LAYER,
        type: "line",
        source: STRAIGHT_SOURCE,
        layout: round,
        paint: { "line-color": STRAIGHT_COLOR, "line-dasharray": [0.5, 2.5] },
      });
      // A linha colorida é clicável.
      map.on("mouseenter", STREET_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", STREET_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    // Com a rota pelas ruas no mapa, as retas ficam mais discretas.
    map.setPaintProperty(STRAIGHT_LAYER, "line-width", streetLegs ? 3 : 4);
    map.setPaintProperty(STRAIGHT_LAYER, "line-opacity", streetLegs ? 0.75 : 0.9);
  }, [points, path, streetLegs, doneKey, colorKey, tracking, styleVersion, t]);

  // Seta da posição atual (viagem). Ela desliza de uma leitura do GPS para a
  // seguinte (sem pulos), gruda na linha da rota quando está perto dela, gira
  // para o lado em que o carro está indo e leva junto a câmera e o corte da
  // linha percorrida.
  const meLat = me?.lat;
  const meLng = me?.lng;
  const meAt = me?.at;
  const meHeading = me?.heading ?? null;
  const meAccuracy = me?.accuracy ?? 30;
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || styleVersion === 0) return;
    if (meLat === undefined || meLng === undefined || meAt === undefined) {
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      shownRef.current = null;
      rawRef.current = null;
      lastFixAtRef.current = null;
      return;
    }
    if (!meMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "pin-me";
      element.innerHTML = ARROW_SVG;
      element.style.width = `${arrowSize(map.getZoom())}px`;
      element.style.height = element.style.width;
      element.title = t.gps.here;
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", t.gps.here);
      meMarkerRef.current = new lib.Marker({ element, rotationAlignment: "map", pitchAlignment: "map" })
        .setLngLat([meLng, meLat])
        .addTo(map);
    }
    const marker = meMarkerRef.current;
    const target: LngLat = [meLng, meLat];
    const fromRaw = rawRef.current ?? target;
    // A animação dura o intervalo entre as leituras: a seta chega quando a próxima leitura sai.
    const gap = lastFixAtRef.current === null ? 0 : meAt - lastFixAtRef.current;
    lastFixAtRef.current = meAt;
    const duration = Math.min(Math.max(gap, 300), 1_600);
    const started = performance.now();
    const navPadding = routePadding(map, layout);
    // Na viagem, a seta fica mais para baixo da tela, com mais caminho à frente.
    navPadding.top += map.getContainer().clientHeight * 0.28;
    let lastLineAt = 0;
    let frame = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const raw: LngLat = [fromRaw[0] + (target[0] - fromRaw[0]) * t, fromRaw[1] + (target[1] - fromRaw[1]) * t];
      rawRef.current = raw;
      let position = raw;
      let wanted = meHeading ?? shownRef.current?.bearing ?? 0;
      const streets = streetsRef.current;
      if (trackingRef.current && streets) {
        const { data, snapped } = withProgress(streets, raw, meAccuracy);
        if (snapped) {
          position = snapped.point;
          // A seta e o mapa apontam para onde o carro está indo (direção do GPS),
          // como no Waze. A direção da via só vale enquanto o GPS não sabe a dele.
          if (meHeading === null) wanted = snapped.bearing;
        }
        // A linha é redesenhada ~10 vezes por segundo (mais que isso só pesa no celular).
        if (now - lastLineAt >= 100 || t === 1) {
          (map.getSource(STREET_SOURCE) as GeoJSONSource | undefined)?.setData(data);
          lastLineAt = now;
        }
      }
      const previous = shownRef.current?.bearing ?? wanted;
      const bearing = lerpAngle(previous, wanted, 0.18);
      shownRef.current = { lng: position[0], lat: position[1], bearing };
      marker.setLngLat(position).setRotation(bearing);
      let cameraMoving = false;
      if (followRef.current && Date.now() >= followPauseRef.current) {
        const zoomNow = map.getZoom();
        const pitchNow = map.getPitch();
        const zoomTarget = zoomTargetRef.current ?? zoomNow;
        const zoom = Math.abs(zoomTarget - zoomNow) < 0.01 ? zoomTarget : zoomNow + (zoomTarget - zoomNow) * CAMERA_EASE;
        const pitch = Math.abs(NAV_PITCH - pitchNow) < 0.1 ? NAV_PITCH : pitchNow + (NAV_PITCH - pitchNow) * CAMERA_EASE;
        cameraMoving = zoom !== zoomTarget || pitch !== NAV_PITCH;
        map.jumpTo({
          center: position,
          bearing: headingUpRef.current ? bearing : 0,
          zoom,
          pitch,
          padding: navPadding,
        });
      }
      if (t < 1 || cameraMoving || Math.abs(angleDelta(bearing, wanted)) > 0.5) {
        frame = window.requestAnimationFrame(step);
      }
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [meLat, meLng, meAt, meHeading, meAccuracy, layout, styleVersion, t]);

  // Começo e fim do "seguir": aproxima em 3D ao iniciar e volta ao mapa plano, com o norte para cima, no fim.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleVersion === 0) return;
    if (follow) {
      followPauseRef.current = 0;
      // Só aproxima: se a pessoa já estava mais perto, fica onde está.
      zoomTargetRef.current = Math.max(map.getZoom(), compact ? NAV_ZOOM_COMPACT : NAV_ZOOM_DESKTOP);
      const shown = shownRef.current;
      // Primeiro passo da aproximação, já centralizando na seta (o resto segue a cada quadro).
      map.easeTo({
        ...(shown ? { center: [shown.lng, shown.lat] as LngLat } : {}),
        zoom: map.getZoom() + (zoomTargetRef.current - map.getZoom()) * 0.35,
        pitch: NAV_PITCH * 0.5,
        duration: 1200,
      });
    } else if (!tracking && (map.getPitch() !== 0 || map.getBearing() !== 0)) {
      // Fim da viagem: volta ao mapa plano, com o norte para cima (pausada, continua em 3D).
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }, [follow, tracking, compact, styleVersion]);

  // Ligar ou desligar a rotação sem esperar a próxima leitura do GPS.
  useEffect(() => {
    const map = mapRef.current;
    const shown = shownRef.current;
    if (!map || styleVersion === 0 || !followRef.current || !shown) return;
    map.easeTo({ bearing: headingUp ? shown.bearing : 0, duration: 500 });
  }, [headingUp, styleVersion]);

  // Trecho clicado em destaque: os outros ficam semitransparentes e ele passa por cima.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleVersion === 0 || !map.getLayer(STREET_LAYER)) return;
    const isSelected: ExpressionSpecification = ["==", ["get", "index"], selectedLeg ?? -1];
    map.setPaintProperty(STREET_LAYER, "line-opacity", selectedLeg === null ? 1 : ["case", isSelected, 1, 0.25]);
    map.setPaintProperty(STREET_CASING, "line-opacity", selectedLeg === null ? 0.9 : ["case", isSelected, 0.95, 0.2]);
    map.setLayoutProperty(STREET_LAYER, "line-sort-key", ["case", isSelected, 1, 0]);
    map.setLayoutProperty(STREET_CASING, "line-sort-key", ["case", isSelected, 1, 0]);
  }, [selectedLeg, streetLegs, styleVersion]);

  // Balão de informação.
  const popupLat = popupAt?.lat;
  const popupLng = popupAt?.lng;
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !popupEl || styleVersion === 0) return;
    if (popupLat === undefined || popupLng === undefined) return;

    let closedByUs = false;
    const popup = new lib.Popup({ offset: 18, maxWidth: "320px", focusAfterOpen: false })
      .setLngLat([popupLng, popupLat])
      .setDOMContent(popupEl)
      .addTo(map);
    popup.on("close", () => {
      if (!closedByUs) handlePopupClose();
    });

    // Se o balão abrir embaixo de um bloco do HUD, desloca o mapa o mínimo para ele aparecer inteiro.
    const frame = window.requestAnimationFrame(() => {
      const box = popup.getElement()?.getBoundingClientRect();
      if (!box) return;
      const margin = 12;
      let best: [number, number] | null = null;
      document.querySelectorAll<HTMLElement>("[data-map-overlay]").forEach((overlay) => {
        const o = overlay.getBoundingClientRect();
        const overlaps =
          o.width > 0 && box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top;
        if (!overlaps) return;
        // Quatro saídas possíveis (esquerda, direita, cima, baixo): fica com a mais curta.
        const moves: [number, number][] = [
          [o.left - box.right - margin, 0],
          [o.right - box.left + margin, 0],
          [0, o.top - box.bottom - margin],
          [0, o.bottom - box.top + margin],
        ];
        const shortest = moves.reduce((a, b) => (Math.hypot(...a) <= Math.hypot(...b) ? a : b));
        if (!best || Math.hypot(...shortest) > Math.hypot(...best)) best = shortest;
      });
      if (best) map.panBy([-best[0], -best[1]], { duration: 300 });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      closedByUs = true;
      popup.remove();
    };
  }, [popupLat, popupLng, popupEl, styleVersion]);

  // Enquadra a rota no espaço livre do HUD.
  const boundsKey = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || styleVersion === 0 || boundsKey === "" || tracking) return;
    // Saindo da viagem: o enquadramento da rota já começa no mapa plano.
    if (map.getPitch() !== 0 || map.getBearing() !== 0) map.jumpTo({ pitch: 0, bearing: 0 });

    const coords = boundsKey.split("|").map((pair) => {
      const [lat, lng] = pair.split(",").map(Number);
      return [lng, lat] as [number, number];
    });
    const padding = routePadding(map, layout);

    if (coords.length === 1) {
      map.easeTo({ center: coords[0], zoom: Math.max(map.getZoom(), 13), padding, duration: 400 });
      return;
    }
    const bounds = coords.reduce(
      (acc, c) => acc.extend(c),
      new lib.LngLatBounds(coords[0], coords[0]),
    );
    try {
      map.fitBounds(bounds, { padding, maxZoom: 15, duration: 400 });
    } catch (err) {
      console.warn("Não foi possível enquadrar a rota no mapa.", err);
    }
  }, [boundsKey, layout, fitVersion, styleVersion, size, tracking]);

  return (
    <div
      className={`absolute inset-0 ${navHeader ? "rotas-nav-header" : ""}`}
      style={{ "--inset-left": `${columnInsets.left}px`, "--inset-right": `${columnInsets.right}px` } as CSSProperties}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label={t.map.aria}
      />
      {popupEl && popupAt && createPortal(children, popupEl)}
      {status === "loading" && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted">
          {t.map.loading}
        </p>
      )}
      {status === "error" && (
        <p
          role="alert"
          className="absolute left-1/2 top-1/2 w-72 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-4 text-center text-sm text-ink shadow-panel"
        >
          {t.map.error}
        </p>
      )}
      {(!streetLegs || status === "fallback") && status !== "error" && status !== "loading" && (
        <ul
          className="pointer-events-none absolute bottom-[9.5rem] left-2 flex flex-col gap-1 text-xs font-medium md:bottom-auto md:left-[calc(var(--inset-left)+0.75rem)] md:top-2.5"
        >
          {!streetLegs && (
            <li className="w-fit rounded-md bg-surface px-2 py-1 text-ink-2 shadow-panel">
              {t.map.approximate}
            </li>
          )}
          {status === "fallback" && (
            <li className="w-fit rounded-md bg-amber-50 px-2 py-1 text-amber-900 shadow-panel">
              {t.map.fallback}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
