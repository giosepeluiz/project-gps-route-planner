"use client";

import { useState } from "react";
import { useT } from "./I18nProvider";
import { formatDuration } from "@/lib/format";
import { MAX_DWELL_MINUTES } from "@/lib/types";

/** Opções comuns de permanência, em minutos. */
export const DWELL_PRESETS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
const OTHER = "outro";
const HOURS = Array.from({ length: MAX_DWELL_MINUTES / 60 + 1 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

export const selectClass =
  "focus-ring rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-compact text-ink outline-none transition-colors duration-150 hover:border-line-strong focus:border-accent motion-reduce:transition-none";

interface DwellPickerProps {
  /** Nome acessível (ex.: "Quanto tempo fica em Belém"). */
  label: string;
  value: number;
  onChange: (minutes: number) => void;
  /** Foca a lista ao aparecer (seletor aberto pelo relógio da parada). */
  autoFocus?: boolean;
}

/**
 * Tempo de permanência: lista com os valores comuns e "Outro…", que mostra o
 * seletor de horas e minutos para qualquer valor até 12 h.
 */
export default function DwellPicker({ label, value, onChange, autoFocus = false }: DwellPickerProps) {
  const t = useT();
  /** true depois de escolher "Outro…" (mesmo que o valor coincida com uma opção). */
  const [custom, setCustom] = useState(() => !DWELL_PRESETS.includes(value));
  const showCustom = custom || !DWELL_PRESETS.includes(value);
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  // Valor fora da grade de 5 min (de versões antigas) continua selecionável.
  const minuteOptions = MINUTES.includes(minutes) ? MINUTES : [...MINUTES, minutes].sort((a, b) => a - b);

  const setTime = (h: number, m: number) => onChange(Math.min(h * 60 + m, MAX_DWELL_MINUTES));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={label}
        autoFocus={autoFocus}
        value={showCustom ? OTHER : String(value)}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(Number(e.target.value));
        }}
        className={selectClass}
      >
        {DWELL_PRESETS.map((m) => (
          <option key={m} value={m}>
            {m === 0 ? t.dwell.none : formatDuration(m * 60)}
          </option>
        ))}
        <option value={OTHER}>{t.dwell.other}</option>
      </select>

      {showCustom && (
        <span role="group" aria-label={t.dwell.custom} className="flex items-center gap-1.5 text-xs text-muted">
          <select
            aria-label={t.dwell.hours}
            value={hours}
            onChange={(e) => setTime(Number(e.target.value), Number(e.target.value) * 60 >= MAX_DWELL_MINUTES ? 0 : minutes)}
            className={selectClass}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <span aria-hidden="true">h</span>
          <select
            aria-label={t.dwell.minutesLabel}
            value={minutes}
            disabled={hours * 60 >= MAX_DWELL_MINUTES}
            onChange={(e) => setTime(hours, Number(e.target.value))}
            className={`${selectClass} disabled:opacity-50`}
          >
            {minuteOptions.map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, "0")}
              </option>
            ))}
          </select>
          <span aria-hidden="true">{t.dwell.minutes}</span>
        </span>
      )}
    </div>
  );
}
