"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AddressSuggestion } from "@/lib/place-input";

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
  /** Busca sugestões de endereço enquanto a pessoa digita (autocompletar). */
  suggest?: (text: string, signal: AbortSignal) => Promise<AddressSuggestion[]>;
  /** Escolha de uma sugestão. Devolve uma mensagem de erro ou null se deu certo. */
  onPick?: (suggestion: AddressSuggestion) => Promise<string | null> | string | null;
}

/** Espera a pessoa parar de digitar antes de pedir sugestões (poupa a cota). */
const SUGGEST_DELAY_MS = 350;

export const inputClass =
  "w-full min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-faint outline-none transition-[border-color,background-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:bg-surface focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

export default function PlaceField({
  label,
  value,
  placeholder,
  disabled = false,
  addMode = false,
  onSubmit,
  suggest,
  onPick,
}: PlaceFieldProps) {
  const inputId = useId();
  const messageId = `${inputId}-msg`;
  const listId = `${inputId}-sugestoes`;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  /** Sugestão destacada pelas setas (-1 = nenhuma). */
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const suggestRef = useRef(suggest);
  useEffect(() => {
    suggestRef.current = suggest;
  });

  // Autocompletar: pede sugestões um pouco depois da última tecla.
  useEffect(() => {
    const text = draft?.trim() ?? "";
    if (!suggestRef.current || !focused || text.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void suggestRef.current?.(text, controller.signal).then((list) => {
        if (controller.signal.aborted) return;
        setSuggestions(list);
        setActive(-1);
      });
    }, SUGGEST_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft, focused]);

  const typed = draft?.trim() ?? "";
  const open = focused && !busy && typed.length >= 3 && suggestions.length > 0;

  const closeList = () => {
    setSuggestions([]);
    setActive(-1);
  };

  const submit = async () => {
    if (busy) return;
    const text = typed;
    if (!text) {
      setDraft(null);
      setError(null);
      return;
    }
    closeList();
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

  const pick = async (suggestion: AddressSuggestion) => {
    if (!onPick || busy) return;
    closeList();
    setBusy(true);
    setError(null);
    try {
      const problem = await onPick(suggestion);
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
          role={suggest ? "combobox" : undefined}
          aria-autocomplete={suggest ? "list" : undefined}
          aria-expanded={suggest ? open : undefined}
          aria-controls={suggest ? listId : undefined}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          onFocus={() => setFocused(true)}
          // Espera um instante: o clique numa sugestão chega depois do blur.
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
            if (e.target.value.trim().length < 3) closeList();
          }}
          onKeyDown={(e) => {
            if (open && e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % suggestions.length);
            } else if (open && e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && active >= 0) void pick(suggestions[active]);
              else void submit();
            } else if (e.key === "Escape") {
              if (open) closeList();
              else {
                setDraft(null);
                setError(null);
              }
            }
          }}
        />
        {addMode && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || busy}
            aria-label="Adicionar parada"
            className="focus-ring grid w-[2.6rem] shrink-0 self-stretch place-items-center rounded-lg bg-ink text-lg font-medium text-on-ink transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        )}
      </div>

      {/* A lista fica no fluxo (não flutuante) para não ser cortada pelo cartão do bloco. */}
      {suggest && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Sugestões de endereço"
          hidden={!open}
          className="mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-panel"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.label}|${s.detail}|${s.lat}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, não click: assim o campo não perde o foco antes da escolha.
              onMouseDown={(e) => {
                e.preventDefault();
                void pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 ${i > 0 ? "border-t border-line" : ""} ${
                i === active ? "bg-hover" : ""
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 17.5s5.5-5 5.5-9.25a5.5 5.5 0 10-11 0C4.5 12.5 10 17.5 10 17.5z" />
                <circle cx="10" cy="8.25" r="1.9" />
              </svg>
              <span className="min-w-0">
                <span className="block truncate text-compact font-medium text-ink">{s.label}</span>
                {s.detail && <span className="block truncate text-xs text-muted">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

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
