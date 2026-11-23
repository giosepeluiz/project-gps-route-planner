"use client";

import { useState } from "react";
import DwellPicker from "./DwellPicker";
import { useT } from "./I18nProvider";
import Grip, { gripButtonClass } from "./Grip";
import { dragRowClass, useDragReorder } from "./useDragReorder";
import { formatDuration, formatTime } from "@/lib/format";
import { DONE_LEG_COLOR, legColor } from "@/lib/leg-colors";
import type { Locks } from "@/lib/locks";
import { dwellSecondsOf } from "@/lib/plan";
import type { Place, PlanLeg } from "@/lib/types";
import { rowsOf, type RestBreak } from "@/lib/breaks";

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
  onToggleLock: (id: string) => void;
  onRemove: (id: string) => void;
  /** Muda a permanência (minutos) da parada. */
  onDwellChange: (id: string, minutes: number) => void;
  /** Paradas já concluídas. */
  doneIds: ReadonlySet<string>;
  /** Marca ou desmarca a parada como concluída (toque no número). */
  onToggleDone: (id: string) => void;
  /** Pausas para descanso, cada uma num trecho. */
  breaks: readonly RestBreak[];
  /** Arrastar uma linha (parada ou pausa), em índices da lista com as duas. */
  onMoveRow: (from: number, to: number) => void;
  onBreakChange: (id: string, minutes: number) => void;
  onRemoveBreak: (id: string) => void;
  /** Parada com hora de chegada marcada (modo "chegar até"), ou null. */
  arriveAtStop: string | null;
  /** Hora marcada (hh:mm), quando há. */
  arriveTime: string;
  /** Como vale a hora marcada: recuando a saída ou mantendo a saída. */
  arriveMode: "back" | "fixed";
  /** Marca (ou tira, com null) a hora de chegada numa parada; o resto da rota é replanejado. */
  onArriveAt: (id: string, time: string | null, mode: "back" | "fixed") => void;
}

function CupIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h9v4a4 4 0 01-4 4H8a4 4 0 01-4-4z" />
      <path d="M13 9h1.5a2 2 0 010 4H13" />
      <path d="M7 3.5c0 1 1 1 1 2M10 3.5c0 1 1 1 1 2" />
    </svg>
  );
}

export default function StopList({
  stops,
  legs,
  locks,
  showLegColors,
  onToggleLock,
  onRemove,
  onDwellChange,
  doneIds,
  onToggleDone,
  breaks,
  onMoveRow,
  onBreakChange,
  onRemoveBreak,
  arriveAtStop,
  arriveTime,
  arriveMode,
  onArriveAt,
}: StopListProps) {
  const t = useT();
  const rows = rowsOf(stops, breaks);
  const reorder = useDragReorder(rows.length, onMoveRow);
  /** Parada com o seletor de permanência aberto. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Parada com o campo de hora de chegada aberto. */
  const [arriveEditing, setArriveEditing] = useState<string | null>(null);
  /** Forma escolhida no editor da hora de chegada (começa na que já está valendo). */
  const [arriveStrategy, setArriveStrategy] = useState<"back" | "fixed">(arriveMode);

  return (
    <ol className="flex flex-col" style={{ gap: reorder.gapPx }}>
      {rows.map((row, r) => {
        if (row.kind === "break") {
          const brk = row.brk;
          const dragging = reorder.draggingIndex === r;
          const isEditing = editing === brk.id;
          const pickerId = `pausa-${brk.id}`;
          return (
            <li
              key={brk.id}
              ref={reorder.rowRef(r)}
              style={{ transform: `translateY(${reorder.offsetOf(r)}px)` }}
              className={`relative rounded-lg border border-dashed border-line-strong bg-sunken/60 py-1 pl-0.5 pr-1 ${dragRowClass(dragging, reorder.draggingIndex !== null)}`}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={t.breaks.dragAria}
                  title={t.stops.dragTitle}
                  className={`${gripButtonClass} ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                  {...reorder.handleProps(r)}
                >
                  <Grip />
                </button>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <CupIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-compact font-medium text-ink">{t.breaks.label}</span>
                  <span className="block truncate text-xs text-muted">{t.breaks.meta(formatDuration(brk.minutes * 60))}</span>
                </span>
                <button
                  type="button"
                  aria-expanded={isEditing}
                  aria-controls={pickerId}
                  onClick={() => setEditing(isEditing ? null : brk.id)}
                  aria-label={t.breaks.changeTime(formatDuration(brk.minutes * 60))}
                  title={t.breaks.timeTitle}
                  className={`focus-ring grid h-8 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-150 motion-reduce:transition-none ${
                    isEditing ? "bg-sunken text-ink" : "text-accent hover:bg-hover"
                  }`}
                >
                  <ClockIcon />
                </button>
                <span
                  title={t.breaks.lockedTitle}
                  className="grid h-8 w-7 shrink-0 place-items-center rounded-lg text-amber-700 dark:text-amber-300"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="9" width="12" height="8" rx="2" fill="currentColor" fillOpacity={0.25} />
                    <path d="M7 9V6a3 3 0 016 0v3" />
                  </svg>
                  <span className="sr-only">{t.breaks.lockedTitle}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveBreak(brk.id)}
                  aria-label={t.breaks.remove}
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
                    label={t.breaks.timeTitle}
                    value={brk.minutes}
                    autoFocus
                    noZero
                    onChange={(minutes) => onBreakChange(brk.id, minutes)}
                  />
                </div>
              )}
            </li>
          );
        }
        const stop = row.stop;
        const i = row.index;
        const leg = legs?.[i];
        const locked = locks[stop.id] !== undefined;
        const dragging = reorder.draggingIndex === r;
        const dwellMin = dwellSecondsOf(stop) / 60;
        const isEditing = editing === stop.id;
        const done = doneIds.has(stop.id);
        const pickerId = `permanencia-${stop.id}`;
        return (
          <li
            key={stop.id}
            ref={reorder.rowRef(r)}
            style={{ transform: `translateY(${reorder.offsetOf(r)}px)` }}
            className={`relative rounded-lg py-1.5 pl-0.5 pr-1 ${dragRowClass(
              dragging,
              reorder.draggingIndex !== null,
            )}`}
          >
            <div className="flex items-center gap-1.5">
            {/* Alça: arrastar com o mouse ou o dedo; setas do teclado também movem. */}
            <button
              type="button"
              aria-label={t.stops.dragAria(stop.label)}
              title={t.stops.dragTitle}
              className={`${gripButtonClass} ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
              {...reorder.handleProps(r)}
            >
              <Grip />
            </button>

            {/* O número da parada é o botão de concluir: concluída, vira um ✓ cinza. */}
            <button
              type="button"
              aria-pressed={done}
              onClick={() => onToggleDone(stop.id)}
              aria-label={done ? t.stops.undoDone(stop.label) : t.stops.markDone(stop.label)}
              title={done ? t.stops.doneTitle : t.stops.markDoneTitle}
              className={`focus-ring group/done grid h-6 w-6 shrink-0 place-items-center rounded-full text-2xs font-semibold transition-colors duration-150 motion-reduce:transition-none ${
                done
                  ? "bg-line-strong text-ink-2 hover:bg-faint"
                  : "bg-accent text-white hover:bg-accent/85 dark:text-[#10131c]"
              }`}
            >
              {done ? (
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 10.5l3.2 3L15 7" />
                </svg>
              ) : (
                <>
                  <span className="group-hover/done:hidden">{i + 1}</span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="hidden h-3.5 w-3.5 group-hover/done:block" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 10.5l3.2 3L15 7" />
                  </svg>
                </>
              )}
            </button>

            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-compact font-medium ${
                  done ? "text-faint line-through decoration-faint" : "text-ink"
                }`}
              >
                {stop.label}
              </span>
              <span
                className={`flex items-center gap-1.5 truncate whitespace-nowrap text-xs ${done ? "text-faint" : "text-muted"}`}
                title={
                  leg
                    ? `${t.stops.arrives(formatTime(leg.arriveAt))}${leg.dwellSeconds > 0 ? `, ${t.stops.leaves(formatTime(leg.leaveAt))}` : ""}`
                    : undefined
                }
              >
                {showLegColors && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: done ? DONE_LEG_COLOR : legColor(i) }}
                  />
                )}
                <span className="truncate">
                  {leg
                    ? `${leg.estimated ? "≈ " : "+"}${formatDuration(leg.seconds)} · ${formatTime(leg.arriveAt)}`
                    : "—"}
                  {dwellMin > 0 && (
                    <span className="text-ink-2">
                      {" "}
                      · {t.stops.stays(formatDuration(dwellMin * 60))}
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
                  ? t.stops.dwellSet(stop.label, formatDuration(dwellMin * 60))
                  : t.stops.dwellAsk(stop.label)
              }
              title={t.stops.dwellTitle}
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
              aria-expanded={arriveEditing === stop.id}
              onClick={() => setArriveEditing(arriveEditing === stop.id ? null : stop.id)}
              aria-label={t.stops.arriveAria(stop.label)}
              title={t.stops.arriveTitle}
              className={`focus-ring grid h-8 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-150 motion-reduce:transition-none ${
                arriveEditing === stop.id
                  ? "bg-sunken text-ink"
                  : arriveAtStop === stop.id
                    ? "text-accent hover:bg-hover"
                    : "text-faint hover:bg-hover hover:text-ink"
              }`}
            >
              {/* Bandeira de chegada. */}
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 17.5V3" />
                <path d="M5 3.5h9l-2 3.25 2 3.25H5" fill={arriveAtStop === stop.id ? "currentColor" : "none"} fillOpacity={0.3} />
              </svg>
            </button>

            <button
              type="button"
              aria-pressed={locked}
              onClick={() => onToggleLock(stop.id)}
              aria-label={locked ? t.stops.unlock(stop.label) : t.stops.lock(stop.label, i + 1)}
              title={locked ? t.stops.lockedTitle : t.stops.lockTitle}
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
              aria-label={t.stops.remove(stop.label)}
              className="focus-ring grid h-8 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-red-700 dark:hover:text-red-400"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
            </div>

            {arriveEditing === stop.id && (
              <div className="mb-1 ml-[3.25rem] mr-1 mt-1.5 flex flex-col gap-2">
                <div role="group" aria-label={t.stops.arriveTitle} className="grid grid-cols-2 gap-0.5 rounded-lg bg-sunken p-0.5">
                  {(
                    [
                      ["back", t.stops.arriveBack],
                      ["fixed", t.stops.arriveFixed],
                    ] as const
                  ).map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={arriveStrategy === value}
                      onClick={() => {
                        setArriveStrategy(value);
                        if (arriveAtStop === stop.id && arriveTime) onArriveAt(stop.id, arriveTime, value);
                      }}
                      className={`focus-ring rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150 ${
                        arriveStrategy === value ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted hover:text-ink"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <p className="text-2xs text-muted">{arriveStrategy === "back" ? t.stops.arriveBackHint : t.stops.arriveFixedHint}</p>
                <div className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-ink-2">
                  <span className="truncate">{t.stops.arriveLabel(stop.label)}</span>
                  <input
                    type="time"
                    autoFocus
                    defaultValue={arriveAtStop === stop.id ? arriveTime : ""}
                    onChange={(e) => e.target.value && onArriveAt(stop.id, e.target.value, arriveStrategy)}
                    className="focus-ring w-[6.5rem] shrink-0 rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
                  />
                </label>
                {arriveAtStop === stop.id && (
                  <button
                    type="button"
                    onClick={() => {
                      onArriveAt(stop.id, null, arriveStrategy);
                      setArriveEditing(null);
                    }}
                    className="focus-ring shrink-0 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:bg-hover"
                  >
                    {t.stops.arriveClear}
                  </button>
                )}
                </div>
              </div>
            )}

            {isEditing && (
              <div id={pickerId} className="mb-1 ml-[3.25rem] mr-1 mt-1.5">
                <DwellPicker
                  label={t.stops.dwellGroup(stop.label)}
                  value={dwellMin}
                  autoFocus
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
