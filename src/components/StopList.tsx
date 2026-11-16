"use client";

import Grip, { gripButtonClass } from "./Grip";
import { dragRowClass, useDragReorder } from "./useDragReorder";
import { formatDuration, formatTime } from "@/lib/format";
import { legColor } from "@/lib/leg-colors";
import type { Locks } from "@/lib/locks";
import type { Place, PlanLeg } from "@/lib/types";

interface StopListProps {
  /** Paradas na ordem exibida (a ordem da visita). */
  stops: readonly Place[];
  /** Trechos do plano; legs[i] é o trecho que chega na parada i. */
  legs: readonly PlanLeg[] | undefined;
  locks: Locks;
  /** true quando a rota pelas ruas está no mapa (a cor do trecho aparece na lista). */
  showLegColors: boolean;
  onMove: (from: number, to: number) => void;
  onToggleLock: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function StopList({
  stops,
  legs,
  locks,
  showLegColors,
  onMove,
  onToggleLock,
  onRemove,
}: StopListProps) {
  const reorder = useDragReorder(stops.length, onMove);

  return (
    <ol className="flex flex-col" style={{ gap: reorder.gapPx }}>
      {stops.map((stop, i) => {
        const leg = legs?.[i];
        const locked = locks[stop.id] !== undefined;
        const dragging = reorder.draggingIndex === i;
        return (
          <li
            key={stop.id}
            ref={reorder.rowRef(i)}
            style={{ transform: `translateY(${reorder.offsetOf(i)}px)` }}
            className={`relative flex items-center gap-1.5 rounded-lg py-1.5 pl-0.5 pr-1 ${dragRowClass(
              dragging,
              reorder.draggingIndex !== null,
            )}`}
          >
            {/* Alça: arrastar com o mouse ou o dedo; setas do teclado também movem. */}
            <button
              type="button"
              aria-label={`Arrastar ${stop.label} para reordenar. Com o teclado, use as setas para cima e para baixo.`}
              title="Arraste para reordenar"
              className={`${gripButtonClass} ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
              {...reorder.handleProps(i)}
            >
              <Grip />
            </button>

            <span
              aria-hidden="true"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-semibold text-white"
            >
              {i + 1}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{stop.label}</span>
              <span className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                {showLegColors && (
                  <span
                    aria-hidden="true"
                    title="Cor deste trecho no mapa"
                    className="h-1.5 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: legColor(i) }}
                  />
                )}
                {leg
                  ? `${leg.estimated ? "≈ " : "+"}${formatDuration(leg.seconds)} · chega ${formatTime(leg.arriveAt)}`
                  : "—"}
              </span>
            </span>

            <button
              type="button"
              aria-pressed={locked}
              onClick={() => onToggleLock(stop.id)}
              aria-label={locked ? `Destravar ${stop.label}` : `Travar ${stop.label} na posição ${i + 1}`}
              title={locked ? "Travado nesta posição" : "Travar nesta posição"}
              className={`focus-ring grid h-8 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-200 motion-reduce:transition-none ${
                locked
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
                  : "text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="9" width="12" height="8" rx="2" fill={locked ? "currentColor" : "none"} fillOpacity={locked ? 0.25 : 0} />
                <path d={locked ? "M7 9V6a3 3 0 016 0v3" : "M7 9V6a3 3 0 015.6-1.5"} />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => onRemove(stop.id)}
              aria-label={`Remover ${stop.label}`}
              className="focus-ring grid h-8 w-7 shrink-0 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-200 hover:text-red-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-red-400"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
