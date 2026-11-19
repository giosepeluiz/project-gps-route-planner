"use client";

import { useEffect, useRef } from "react";
import { useT } from "./I18nProvider";

interface ResumeDialogProps {
  /** Resumo do que está guardado (ex.: "3 paradas"). */
  summary: string;
  onContinue: () => void;
  onFresh: () => void;
}

/** Ao abrir com uma rota guardada: continuar ou começar do zero. */
export default function ResumeDialog({ summary, onContinue, onFresh }: ResumeDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const choseRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const choose = (fn: () => void) => {
    choseRef.current = true;
    ref.current?.close();
    fn();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="retomar-titulo"
      aria-describedby="retomar-texto"
      // Esc ou clique fora: continua (não apaga nada sem a pessoa pedir).
      onClose={() => {
        if (!choseRef.current) onContinue();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      className="m-auto w-[min(24rem,calc(100vw-2rem))] lg:w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 px-6 pb-5 pt-6">
        <h2 id="retomar-titulo" className="text-lg font-semibold">
          {t.resume.title}
        </h2>
        <div id="retomar-texto" className="flex flex-col gap-2 text-sm text-ink-2">
          <p>{t.resume.body(summary)}</p>
          <p className="text-xs text-muted">{t.resume.note}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            autoFocus
            onClick={() => choose(onContinue)}
            className="focus-ring flex-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:bg-ink/85"
          >
            {t.resume.continue}
          </button>
          <button
            type="button"
            onClick={() => choose(onFresh)}
            className="focus-ring flex-1 rounded-lg border border-line-strong px-4 py-2.5 text-sm font-medium text-ink-2 hover:bg-hover"
          >
            {t.resume.fresh}
          </button>
        </div>
      </div>
    </dialog>
  );
}
