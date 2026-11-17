"use client";

import { useState } from "react";
import DwellPicker from "./DwellPicker";
import Grip, { gripButtonClass } from "./Grip";
import { dragRowClass, useDragReorder } from "./useDragReorder";
import { formatDuration, formatTime } from "@/lib/format";
import { legColor } from "@/lib/leg-colors";
import type { Locks } from "@/lib/locks";
import { dwellSecondsOf } from "@/lib/plan";
import type { Place, PlanLeg } from "@/lib/types";

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.5V10l2.5 1.5" />
    </svg>
  );
}

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
  /** Muda a permanência (minutos) da parada. */
  onDwellChange: (id: string, minutes: number) => void;
}

export default function StopList({
  stops,
  legs,
  locks,
  showLegColors,
  onMove,
  onToggleLock,
  onRemove,
  onDwellChange,
}: StopListProps) {
  const reorder = useDragReorder(stops.length, onMove);
  /** Parada com o seletor de permanência aberto. */
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <ol className="flex flex-col" style={{ gap: reorder.gapPx }}>
      {stops.map((stop, i) => {
        const leg = legs?.[i];
        const locked = locks[stop.id] !== undefined;
        const dragging = reorder.draggingIndex === i;
        const dwellMin = dwellSecondsOf(stop) / 60;
        const isEditing = editing === stop.id;
        const pickerId = `permanencia-${stop.id}`;
        return (
          <li
            key={stop.id}
            ref={reorder.rowRef(i)}
            style={{ transform: `translateY(${reorder.offsetOf(i)}px)` }}
            className={`relative rounded-lg py-1.5 pl-0.5 pr-1 ${dragRowClass(
              dragging,
              reorder.draggingIndex !== null,
            )}`}
          >
            <div className="flex items-center gap-1.5">
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
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-2xs font-semibold text-white dark:text-[#10131c]"
            >
              {i + 1}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-compact font-medium text-ink">{stop.label}</span>
              <span
                className="flex items-center gap-1.5 truncate whitespace-nowrap text-xs text-muted"
                title={
                  leg
                    ? `Chega às ${formatTime(leg.arriveAt)}${leg.dwellSeconds > 0 ? `, sai às ${formatTime(leg.leaveAt)}` : ""}`
                    : undefined
                }
              >
                {showLegColors && (
                  <span
                    aria-hidden="true"
                    title="Cor deste trecho no mapa"
                    className="h-1.5 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: legColor(i) }}
                  />
                )}
                <span className="truncate">
                  {leg
                    ? `${leg.estimated ? "≈ " : "+"}${formatDuration(leg.seconds)} · ${formatTime(leg.arriveAt)}`
                    : "—"}
                  {dwellMin > 0 && (
                    <span className="text-ink-2">
                      {" "}
                      · fica {formatDuration(dwellMin * 60)}
                    </span>
                  )}
                </span>
              </span>
            </span>

            <button
              type="button"
              aria-expanded={isEditing}
              aria-controls={pickerId}
              onClick={() => setEditing(isEditing ? null : stop.id)}
              aria-label={
                dwellMin > 0
                  ? `Permanência em ${stop.label}: ${formatDuration(dwellMin * 60)}. Alterar`
                  : `Definir quanto tempo fica em ${stop.label}`
              }
              title="Tempo de permanência"
              className={`focus-ring grid h-8 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-150 motion-reduce:transition-none ${
                isEditing
                  ? "bg-sunken text-ink"
                  : dwellMin > 0
                    ? "text-accent hover:bg-hover"
                    : "text-faint hover:bg-hover hover:text-ink"
              }`}
            >
              <ClockIcon />
            </button>

            <button
              type="button"
              aria-pressed={locked}
              onClick={() => onToggleLock(stop.id)}
              aria-label={locked ? `Destravar ${stop.label}` : `Travar ${stop.label} na posição ${i + 1}`}
              title={locked ? "Travado nesta posição" : "Travar nesta posição"}
              className={`focus-ring grid h-8 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-200 motion-reduce:transition-none ${
 locked
 ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
 : "text-faint hover:bg-hover hover:text-ink"
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
              className="focus-ring grid h-8 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-red-700 dark:hover:text-red-400"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
            </div>

            {isEditing && (
              <div id={pickerId} className="mb-1 ml-[3.25rem] mr-1 mt-1.5">
                <DwellPicker
                  label={`Quanto tempo fica em ${stop.label}`}
                  value={dwellMin}
                  onChange={(minutes) => onDwellChange(stop.id, minutes)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
