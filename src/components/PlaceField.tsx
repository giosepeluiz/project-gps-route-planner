"use client";

import { useId, useState } from "react";

interface PlaceFieldProps {
  label: string;
  /** Texto do local atual (mostrado quando não há edição em curso). */
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** Mostra o botão + e limpa o campo depois de enviar (campo de adicionar parada). */
  addMode?: boolean;
  /** Recebe o texto digitado. Devolve uma mensagem de erro ou null se deu certo. */
  onSubmit: (text: string) => Promise<string | null>;
}

export const inputClass =
  "w-full min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-faint outline-none transition-[border-color,background-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:bg-surface focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";


export default function PlaceField({
  label,
  value,
  placeholder,
  disabled = false,
  addMode = false,
  onSubmit,
}: PlaceFieldProps) {
  const inputId = useId();
  const messageId = `${inputId}-msg`;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const text = (draft ?? "").trim();
    if (!text) {
      setDraft(null);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const problem = await onSubmit(text);
      setError(problem);
      if (!problem) setDraft(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-ink-2">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          enterKeyHint={addMode ? "done" : "search"}
          className={inputClass}
          value={draft ?? value}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={busy}
          aria-busy={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || busy ? messageId : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              setDraft(null);
              setError(null);
            }
          }}
        />
        {addMode && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || busy}
            aria-label="Adicionar parada"
            className="focus-ring grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg bg-ink text-lg font-medium text-on-ink transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        )}
      </div>
      {busy && (
        <p id={messageId} role="status" className="mt-1 text-xs text-muted">
          Buscando o local…
        </p>
      )}
      {error && !busy && (
        <p id={messageId} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
