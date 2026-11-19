"use client";

import { useEffect, useId, useRef, useState } from "react";
import DwellPicker, { selectClass } from "./DwellPicker";
import { useT } from "./I18nProvider";
import { DEFAULT_BREAK_MINUTES } from "@/lib/breaks";

export interface LegOption {
  /** Trecho (quantas paradas vêm antes). */
  value: number;
  label: string;
  /** Já tem uma pausa (duas pausas não podem ficar juntas). */
  disabled: boolean;
}

interface BreakDialogProps {
  options: LegOption[];
  onConfirm: (minutes: number, after: number) => void;
  onCancel: () => void;
}

/**
 * Nova pausa para descanso: quanto tempo e em que trecho. Montado só quando
 * abre (o estado começa do zero a cada vez).
 */
export default function BreakDialog({ options, onConfirm, onCancel }: BreakDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const positionId = useId();
  const confirmedRef = useRef(false);
  const [minutes, setMinutes] = useState(DEFAULT_BREAK_MINUTES);
  // Sugere o trecho livre do meio da rota (descanso costuma ser no meio do caminho).
  const free = options.filter((o) => !o.disabled);
  const [after, setAfter] = useState(() => free[Math.floor((free.length - 1) / 2)]?.value ?? 0);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="pausa-titulo"
      onClose={() => {
        if (!confirmedRef.current) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] lg:w-[min(33rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/50"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 px-6 pb-5 pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          confirmedRef.current = true;
          onConfirm(minutes, after);
          ref.current?.close();
        }}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h9v4a4 4 0 01-4 4H8a4 4 0 01-4-4z" />
              <path d="M13 9h1.5a2 2 0 010 4H13" />
              <path d="M7 3.5c0 1 1 1 1 2M10 3.5c0 1 1 1 1 2" />
            </svg>
          </span>
          <h2 id="pausa-titulo" className="text-lg font-semibold">
            {t.breaks.dialogTitle}
          </h2>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t.breaks.howLong}</p>
          <DwellPicker label={t.breaks.howLong} value={minutes} onChange={setMinutes} noZero autoFocus />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={positionId} className="text-sm font-medium">
            {t.breaks.where}
          </label>
          <select
            id={positionId}
            value={after}
            onChange={(e) => setAfter(Number(e.target.value))}
            className={`${selectClass} w-full`}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.disabled ? t.breaks.taken(o.label) : o.label}
              </option>
            ))}
          </select>
        </div>

        <p className="rounded-lg bg-sunken px-3 py-2 text-xs leading-relaxed text-ink-2">{t.breaks.note}</p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="focus-ring flex-1 rounded-lg border border-line-strong px-4 py-2.5 text-sm font-medium text-ink-2 hover:bg-hover"
          >
            {t.breaks.cancel}
          </button>
          <button
            type="submit"
            disabled={free.length === 0}
            className="focus-ring flex-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:bg-ink/85 disabled:opacity-50"
          >
            {t.breaks.add}
          </button>
        </div>
      </form>
    </dialog>
  );
}
