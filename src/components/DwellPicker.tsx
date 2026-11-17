"use client";

import { useId, useState } from "react";
import { MAX_DWELL_MINUTES } from "@/lib/types";

/** Atalhos de permanência, em minutos. */
const PRESETS = [0, 5, 10, 15, 30, 45, 60, 120];

const presetLabel = (minutes: number) =>
  minutes === 0 ? "Nenhum" : minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;

interface DwellPickerProps {
  /** Nome acessível do grupo (ex.: "Quanto tempo fica em Belém"). */
  label: string;
  value: number;
  onChange: (minutes: number) => void;
}

/** Escolha do tempo de permanência: atalhos comuns e um campo para qualquer valor. */
export default function DwellPicker({ label, value, onChange }: DwellPickerProps) {
  const inputId = useId();
  /** Texto em edição; null = mostra o valor atual (que pode ter mudado por um atalho). */
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    setDraft(null);
    const minutes = Math.round(Number(text.replace(",", ".")));
    if (text.trim() === "" || !Number.isFinite(minutes) || minutes < 0) return;
    onChange(Math.min(minutes, MAX_DWELL_MINUTES));
  };

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={value === minutes}
            onClick={() => onChange(minutes)}
            className={`focus-ring rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none ${
              value === minutes
                ? "border-accent bg-accent text-white dark:text-[#10131c]"
                : "border-line text-ink-2 hover:border-line-strong hover:bg-hover"
            }`}
          >
            {presetLabel(minutes)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <label htmlFor={inputId}>Outro valor</label>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_DWELL_MINUTES}
          step={5}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget.value);
            }
          }}
          className="focus-ring w-16 rounded-md border border-line bg-surface-2 px-2 py-1 text-right text-xs text-ink outline-none focus:border-accent"
        />
        <span>min</span>
      </div>
    </div>
  );
}
