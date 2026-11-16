"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { legColor } from "@/lib/leg-colors";
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
  layout: MapLayout;
  /** Altura (px) ocupada pelo bloco Resumo no canto inferior esquerdo, no desktop. */
  desktopBottomInset: number;
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

export default function MapView({
  points,
  path,
  streetLegs,
  onLegClick,
  layout,
  desktopBottomInset,
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
  const handleBounds = useEffectEvent((map: MapLibreMap) => {
    const b = map.getBounds();
    onBoundsChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  });

  // Cria o mapa uma única vez.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let detachMedia: (() => void) | null = null;

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

      // Atribuição sempre aberta. No celular vai para o topo, fora da gaveta.
      const media = window.matchMedia(DESKTOP_QUERY);
      let attribution: InstanceType<MapLibre["AttributionControl"]> | null = null;
      let zoom: InstanceType<MapLibre["NavigationControl"]> | null = null;
      const placeControls = () => {
        if (!map) return;
        if (attribution) map.removeControl(attribution);
        if (zoom) map.removeControl(zoom);
        zoom = null;
        // Botões de zoom só no desktop; no celular o zoom é por gesto.
        if (media.matches) {
          zoom = new lib.NavigationControl({ showCompass: false });
          map.addControl(zoom, "top-left");
        }
        attribution = new lib.AttributionControl({
          compact: false,
          customAttribution: MAP_ATTRIBUTION,
        });
        map.addControl(attribution, media.matches ? "bottom-left" : "top-left");
      };
      placeControls();
      media.addEventListener("change", placeControls);
      detachMedia = () => media.removeEventListener("change", placeControls);

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
      map.on("load", () => map && handleBounds(map));
    });

    return () => {
      cancelled = true;
      detachMedia?.();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, [fallbackStyleUrl]);

  // Pins e linha da rota.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || styleVersion === 0) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = points.map((point) => {
      const element = document.createElement("div");
      element.className = `pin pin-${point.kind}`;
      element.textContent = point.badge;
      element.title = point.title;
      element.setAttribute("role", "button");
      element.tabIndex = 0;
      element.setAttribute("aria-label", `${point.badge}: ${point.title}. Ver informações.`);
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
    const streets = {
      type: "FeatureCollection" as const,
      features: (streetLegs ?? []).map((coordinates, index) => ({
        type: "Feature" as const,
        properties: { index, color: legColor(index) },
        geometry: { type: "LineString" as const, coordinates },
      })),
    };

    const straightSource = map.getSource(STRAIGHT_SOURCE) as GeoJSONSource | undefined;
    if (straightSource) {
      straightSource.setData(straight);
      (map.getSource(STREET_SOURCE) as GeoJSONSource | undefined)?.setData(streets);
    } else {
      const round = { "line-cap": "round" as const, "line-join": "round" as const };
      map.addSource(STRAIGHT_SOURCE, { type: "geojson", data: straight });
      map.addSource(STREET_SOURCE, { type: "geojson", data: streets });
      map.addLayer({
        id: STREET_CASING,
        type: "line",
        source: STREET_SOURCE,
        layout: round,
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: STREET_LAYER,
        type: "line",
        source: STREET_SOURCE,
        layout: round,
        // Cada trecho tem a sua cor (nenhuma azul, que é a das retas).
        paint: { "line-color": ["get", "color"], "line-width": 5 },
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
  }, [points, path, streetLegs, styleVersion]);

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
    if (!map || !lib || styleVersion === 0 || boundsKey === "") return;

    const coords = boundsKey.split("|").map((pair) => {
      const [lat, lng] = pair.split(",").map(Number);
      return [lng, lat] as [number, number];
    });
    const height = map.getContainer().clientHeight;
    const layoutBottom = desktopBottomInset + 24;
    const padding =
      layout === "desktop"
        ? { top: 56, bottom: layoutBottom, left: 56, right: 392 }
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
  }, [boundsKey, layout, desktopBottomInset, styleVersion, size]);

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label="Mapa da rota. Clique para ver um local; clique direito ou toque longo para adicionar uma parada."
      />
      {popupEl && popupAt && createPortal(children, popupEl)}
      {status === "loading" && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-zinc-600 dark:text-zinc-300">
          Carregando o mapa…
        </p>
      )}
      {status === "error" && (
        <p
          role="alert"
          className="absolute left-1/2 top-1/2 w-72 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-4 text-center text-sm text-zinc-900 shadow-lg dark:bg-zinc-900 dark:text-zinc-100"
        >
          Não foi possível carregar o mapa base. Verifique a conexão e recarregue a página.
        </p>
      )}
      {(!streetLegs || status === "fallback") && status !== "error" && status !== "loading" && (
        <ul className="pointer-events-none absolute bottom-20 left-2 flex flex-col gap-1 text-xs font-medium md:bottom-auto md:left-12 md:top-2.5">
          {!streetLegs && (
            <li className="w-fit rounded-full bg-white/95 px-2.5 py-1 text-zinc-800 shadow dark:bg-zinc-900/95 dark:text-zinc-100">
              Traçado aproximado (sem rota pelas ruas)
            </li>
          )}
          {status === "fallback" && (
            <li className="w-fit rounded-full bg-amber-100 px-2.5 py-1 text-amber-900 shadow">
              Mapa reserva em uso
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
