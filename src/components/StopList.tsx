"use client";

import { useRef, useState } from "react";
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

interface Drag {
  index: number;
  startY: number;
  dy: number;
  /** Altura de uma linha da lista, com o espaçamento. */
  rowHeight: number;
}

const GAP_PX = 4;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function StopList({
  stops,
  legs,
  locks,
  showLegColors,
  onMove,
  onToggleLock,
  onRemove,
}: StopListProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const target = drag
    ? clamp(drag.index + Math.round(drag.dy / drag.rowHeight), 0, stops.length - 1)
    : null;

  /** Deslocamento visual de cada linha enquanto outra é arrastada. */
  const offsetOf = (i: number): number => {
    if (!drag || target === null) return 0;
    if (i === drag.index) return drag.dy;
    if (drag.index < target && i > drag.index && i <= target) return -drag.rowHeight;
    if (drag.index > target && i < drag.index && i >= target) return drag.rowHeight;
    return 0;
  };

  const finish = (commit: boolean) => {
    if (drag && commit && target !== null && target !== drag.index) onMove(drag.index, target);
    setDrag(null);
  };

  return (
    <ol className="flex flex-col" style={{ gap: GAP_PX }}>
      {stops.map((stop, i) => {
        const leg = legs?.[i];
        const locked = locks[stop.id] !== undefined;
        const dragging = drag?.index === i;
        return (
          <li
            key={stop.id}
            ref={(element) => {
              if (element) rowRefs.current.set(stop.id, element);
              else rowRefs.current.delete(stop.id);
            }}
            style={{ transform: `translateY(${offsetOf(i)}px)` }}
            className={`relative flex items-center gap-1.5 rounded-lg py-1.5 pl-0.5 pr-1 motion-reduce:transition-none ${
              dragging
                ? "z-10 bg-white shadow-lg ring-1 ring-zinc-300 dark:bg-zinc-800 dark:ring-zinc-600"
                : `${drag ? "transition-transform duration-150" : "transition-colors duration-200"} hover:bg-zinc-100 dark:hover:bg-zinc-800/70`
            }`}
          >
            {/* Alça: arrastar com o mouse ou o dedo; setas do teclado também movem. */}
            <button
              type="button"
              aria-label={`Arrastar ${stop.label} para reordenar. Com o teclado, use as setas para cima e para baixo.`}
              title="Arraste para reordenar"
              className={`focus-ring grid h-8 w-5 shrink-0 touch-none place-items-center rounded text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 ${
                dragging ? "cursor-grabbing" : "cursor-grab"
              }`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const row = rowRefs.current.get(stop.id);
                if (!row) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({
                  index: i,
                  startY: event.clientY,
                  dy: 0,
                  rowHeight: row.getBoundingClientRect().height + GAP_PX,
                });
              }}
              onPointerMove={(event) => {
                if (!dragging) return;
                setDrag((current) => (current ? { ...current, dy: event.clientY - current.startY } : current));
              }}
              onPointerUp={() => finish(true)}
              onPointerCancel={() => finish(false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" && i > 0) {
                  event.preventDefault();
                  onMove(i, i - 1);
                } else if (event.key === "ArrowDown" && i < stops.length - 1) {
                  event.preventDefault();
                  onMove(i, i + 1);
                }
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 12 20" className="h-4 w-3" fill="currentColor">
                <circle cx="3" cy="4" r="1.5" />
                <circle cx="9" cy="4" r="1.5" />
                <circle cx="3" cy="10" r="1.5" />
                <circle cx="9" cy="10" r="1.5" />
                <circle cx="3" cy="16" r="1.5" />
                <circle cx="9" cy="16" r="1.5" />
              </svg>
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
