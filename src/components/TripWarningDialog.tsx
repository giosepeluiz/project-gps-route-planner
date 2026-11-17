"use client";

import { useEffect, useRef } from "react";
import { useT } from "./I18nProvider";

interface TripWarningDialogProps {
  open: boolean;
  /** "Ciente": fecha e começa a viagem. */
  onAccept: () => void;
  /** Esc ou clique fora: fecha sem começar. */
  onCancel: () => void;
}

/** Aviso antes de iniciar a viagem: o planejador não substitui um app de navegação. */
export default function TripWarningDialog({ open, onAccept, onCancel }: TripWarningDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const acceptedRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      acceptedRef.current = false;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="aviso-viagem-titulo"
      aria-describedby="aviso-viagem-texto"
      onClose={() => {
        if (!acceptedRef.current) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 px-6 pb-5 pt-6">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5l9 16H3z" />
            <path d="M12 10v4.5" />
            <circle cx="12" cy="17.2" r=".5" fill="currentColor" />
          </svg>
        </span>
        <h2 id="aviso-viagem-titulo" className="text-lg font-semibold">
          {t.trip.warningTitle}
        </h2>
        <div id="aviso-viagem-texto" className="flex flex-col gap-2.5 text-sm leading-relaxed text-ink-2">
          <p className="font-medium text-ink">{t.trip.warningLead}</p>
          <p>{t.trip.warningBody}</p>
          <p className="font-medium text-ink">{t.trip.warningSafety}</p>
        </div>
        <button
          type="button"
          autoFocus
          onClick={() => {
            acceptedRef.current = true;
            onAccept();
          }}
          className="focus-ring mt-1 w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:bg-ink/85"
        >
          {t.trip.aware}
        </button>
      </div>
    </dialog>
  );
}
