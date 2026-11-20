"use client";

import { useEffect, useRef } from "react";
import { useT } from "./I18nProvider";

interface LeaveStopDialogProps {
  /** Nome da parada de onde a pessoa se afastou (null = fechado). */
  stopName: string | null;
  /** "Sim": segue para a próxima parada. */
  onYes: () => void;
  /** "Ainda não": continua na parada (estava manobrando). */
  onNo: () => void;
}

/** Depois de chegar numa parada e se afastar uns 1 km: confirma se já está a caminho da próxima. */
export default function LeaveStopDialog({ stopName, onYes, onNo }: LeaveStopDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const open = stopName !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="saiu-parada-titulo"
      onCancel={(e) => {
        e.preventDefault();
        onNo();
      }}
      className="m-auto w-[min(24rem,calc(100vw-2rem))] lg:w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 px-6 pb-5 pt-6">
        <h2 id="saiu-parada-titulo" className="text-lg font-semibold">
          {t.trip.leaveTitle}
        </h2>
        <p className="text-sm leading-relaxed text-ink-2">{t.trip.leaveBody(stopName ?? "")}</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onNo}
            className="focus-ring rounded-lg border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:bg-hover"
          >
            {t.trip.leaveNo}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onYes}
            className="focus-ring rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:bg-ink/85"
          >
            {t.trip.leaveYes}
          </button>
        </div>
      </div>
    </dialog>
  );
}
