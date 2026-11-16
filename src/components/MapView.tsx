"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
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
  /** Linha da rota, em [lng, lat]. */
  path: [number, number][];
  /** true quando a linha não é a geometria real (retas tracejadas). */
  approximate: boolean;
  layout: MapLayout;
  fallbackStyleUrl: string | null;
  onMapClick: (lat: number, lng: number) => void;
}

const ROUTE_SOURCE = "rota";
const ROUTE_LAYER = "rota-linha";
const ROUTE_COLOR = "#2563eb";
const DESKTOP_QUERY = "(min-width: 768px)";

export default function MapView({
  points,
  path,
  approximate,
  layout,
  fallbackStyleUrl,
  onMapClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const markersRef = useRef<Marker[]>([]);
  /** Muda a cada estilo carregado, para redesenhar a rota depois de uma troca de estilo. */
  const [styleVersion, setStyleVersion] = useState(0);
  const [size, setSize] = useState("");
  const [status, setStatus] = useState<"loading" | "ok" | "fallback" | "error">("loading");

  const handleClick = useEffectEvent((lat: number, lng: number) => onMapClick(lat, lng));

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
      const placeAttribution = () => {
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
      placeAttribution();
      media.addEventListener("change", placeAttribution);
      detachMedia = () => media.removeEventListener("change", placeAttribution);

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

      map.on("click", (event) => handleClick(event.lngLat.lat, event.lngLat.lng));
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
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `${point.badge}: ${point.title}`);
      return new lib.Marker({ element }).setLngLat([point.lng, point.lat]).addTo(map);
    });

    const data = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: path },
    };
    const source = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ROUTE_COLOR, "line-width": 4, "line-opacity": 0.85 },
      });
    }
    // Sem geometria real, a linha fica tracejada.
    map.setPaintProperty(ROUTE_LAYER, "line-dasharray", approximate ? [1.5, 2] : [1, 0]);
  }, [points, path, approximate, styleVersion]);

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
    const padding =
      layout === "desktop"
        ? { top: 56, bottom: 56, left: 56, right: 392 }
        : {
            top: 72,
            left: 40,
            right: 40,
            bottom: layout === "sheet-open" ? Math.round(height * 0.6) + 24 : 112,
          };

    if (coords.length === 1) {
      map.easeTo({ center: coords[0], zoom: Math.max(map.getZoom(), 13), padding, duration: 400 });
      return;
    }
    const bounds = coords.reduce(
      (acc, c) => acc.extend(c),
      new lib.LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(bounds, { padding, maxZoom: 15, duration: 400 });
  }, [boundsKey, layout, styleVersion, size]);

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label="Mapa da rota. Clique para adicionar uma parada."
      />
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
      {(approximate || status === "fallback") && status !== "error" && status !== "loading" && (
        <ul className="pointer-events-none absolute bottom-20 left-2 flex flex-col gap-1 text-xs font-medium md:bottom-auto md:left-12 md:top-2.5">
          {approximate && (
            <li className="w-fit rounded-full bg-white/95 px-2.5 py-1 text-zinc-800 shadow dark:bg-zinc-900/95 dark:text-zinc-100">
              Traçado aproximado
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
