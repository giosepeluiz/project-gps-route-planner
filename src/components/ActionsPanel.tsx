"use client";

import { useSyncExternalStore } from "react";
import {
  GOOGLE_WAYPOINTS_DESKTOP,
  GOOGLE_WAYPOINTS_MOBILE,
  googleMapsLinks,
  routeText,
  wazeLink,
} from "@/lib/export";
import type { Place, Plan } from "@/lib/types";

interface ActionsPanelProps {
  start: Place;
  /** Paradas na ordem da visita. */
  stops: readonly Place[];
  /** Ponto final (o próprio início em ida e volta) ou null. */
  finalPlace: Place | null;
  roundTrip: boolean;
  plan: Plan | null;
  /** true em telas estreitas: o Google Maps aceita menos paradas por link no celular. */
  isMobile: boolean;
  onNotify: (text: string) => void;
}

const subscribeNothing = () => () => {};

const linkClass =
  "focus-ring flex items-center justify-between gap-2 rounded-lg border border-zinc-300 px-2.5 py-2 text-sm font-medium transition-colors duration-200 hover:bg-zinc-100 motion-reduce:transition-none dark:border-zinc-600 dark:hover:bg-zinc-800";

function External() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4h5v5M16 4l-7 7M8 5H5a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" />
    </svg>
  );
}

export default function ActionsPanel({
  start,
  stops,
  finalPlace,
  roundTrip,
  plan,
  isMobile,
  onNotify,
}: ActionsPanelProps) {
  const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
  const maxWaypoints = isMobile ? GOOGLE_WAYPOINTS_MOBILE : GOOGLE_WAYPOINTS_DESKTOP;
  const links = googleMapsLinks(sequence, maxWaypoints);
  // Próxima parada: a primeira da rota (ou o fim, se não houver paradas).
  const next = stops[0] ?? (finalPlace && finalPlace.id !== start.id ? finalPlace : null);
  const text = plan ? routeText(start, plan, stops.length, roundTrip, links) : null;
  // Só existe no navegador (e nem em todos): no servidor vale false.
  const canShare = useSyncExternalStore(
    subscribeNothing,
    () => typeof navigator.share === "function",
    () => false,
  );

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      onNotify("Rota copiada.");
    } catch {
      onNotify("Não foi possível copiar a rota.");
    }
  };

  const share = async () => {
    if (!text) return;
    try {
      await navigator.share({ title: "Rota", text });
    } catch {
      // O usuário fechou a folha de compartilhamento: nada a fazer.
    }
  };

  if (links.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Adicione ao menos uma parada (ou um fim) para abrir a rota em outro aplicativo.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {links.map((link, i) => (
        <a key={link} href={link} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <span>
            Abrir no Google Maps
            {links.length > 1 && (
              <span className="block text-xs font-normal text-zinc-600 dark:text-zinc-400">
                Parte {i + 1} de {links.length}
              </span>
            )}
          </span>
          <External />
        </a>
      ))}
      {links.length > 1 && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          O Google Maps aceita até {maxWaypoints} paradas por link{isMobile ? " no celular" : ""}, então a rota
          foi dividida em partes.
        </p>
      )}

      {next && (
        <a href={wazeLink(next)} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <span className="min-w-0">
            Navegar no Waze
            <span className="block truncate text-xs font-normal text-zinc-600 dark:text-zinc-400">
              Próxima parada: {next.label}
            </span>
          </span>
          <External />
        </a>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!text}
          className={`${linkClass} justify-center disabled:cursor-not-allowed disabled:opacity-50 ${canShare ? "" : "col-span-2"}`}
        >
          Copiar rota
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => void share()}
            disabled={!text}
            className={`${linkClass} justify-center disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Compartilhar
          </button>
        )}
      </div>
    </div>
  );
}
