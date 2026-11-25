"use client";

import { useEffect, useRef } from "react";
import { useT } from "./I18nProvider";

interface NewRouteDialogProps {
  open: boolean;
  onYes: () => void;
  onNo: () => void;
}

/** Confirma antes de apagar a rota e começar outra (um toque sem querer, no carro, não pode apagar tudo). */
export default function NewRouteDialog({ open, onYes, onNo }: NewRouteDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="nova-rota-titulo"
      onCancel={(e) => {
        e.preventDefault();
        onNo();
      }}
      className="m-auto w-[min(24rem,calc(100vw-2rem))] lg:w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 px-6 pb-5 pt-6">
        <h2 id="nova-rota-titulo" className="text-lg font-semibold">
          {t.trip.newRouteTitle}
        </h2>
        <p className="text-sm leading-relaxed text-ink-2">{t.trip.newRouteBody}</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            autoFocus
            onClick={onNo}
            className="focus-ring rounded-lg border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:bg-hover"
          >
            {t.trip.newRouteNo}
          </button>
          <button
            type="button"
            onClick={onYes}
            className="focus-ring rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            {t.trip.newRouteYes}
          </button>
        </div>
      </div>
    </dialog>
  );
}
