"use client";

import { useEffect, useRef } from "react";
import { useT } from "./I18nProvider";
import { formatDuration, formatKm, formatTime } from "@/lib/format";
import type { TripSummary } from "@/lib/trip";

interface TripStatsDialogProps {
  open: boolean;
  stats: TripSummary | null;
  onClose: () => void;
}

/** Estatísticas da viagem concluída: previsto × real. */
export default function TripStatsDialog({ open, stats, onClose }: TripStatsDialogProps) {
  const t = useT();
  const s = t.trip.stats;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && stats && !dialog.open) dialog.showModal();
    if ((!open || !stats) && dialog.open) dialog.close();
  }, [open, stats]);

  const dash = "—";
  const compared: [string, string, string][] = stats
    ? [
        [s.time, stats.plannedSeconds === null ? dash : formatDuration(stats.plannedSeconds), formatDuration(stats.actualSeconds)],
        [
          s.arrival,
          stats.plannedArriveAt === null ? dash : formatTime(new Date(stats.plannedArriveAt)),
          formatTime(new Date(stats.arrivedAt)),
        ],
        [s.distance, stats.plannedMeters === null ? dash : formatKm(stats.plannedMeters), formatKm(stats.actualMeters)],
      ]
    : [];
  const single: [string, string][] = stats
    ? [
        [s.stops, String(stats.stopsDone)],
        [s.stopped, formatDuration(stats.stoppedSeconds)],
        [s.speed, stats.averageKmh === null ? dash : `${stats.averageKmh.toFixed(0)} km/h`],
      ]
    : [];
  // Diferença do tempo total: só conta a partir de 1 minuto.
  const diff = stats && stats.plannedSeconds !== null ? stats.actualSeconds - stats.plannedSeconds : null;
  const verdict =
    diff === null
      ? null
      : Math.abs(diff) < 60
        ? { text: s.onTime, tone: "good" as const }
        : diff < 0
          ? { text: s.faster(formatDuration(-diff)), tone: "good" as const }
          : { text: s.slower(formatDuration(diff)), tone: "late" as const };

  return (
    <dialog
      ref={ref}
      aria-labelledby="estatisticas-titulo"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/50"
    >
      {stats && (
        <div className="flex flex-col gap-4 px-6 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 17V3.5M5 4h9l-2 3 2 3H5" />
              </svg>
            </span>
            <div>
              <h2 id="estatisticas-titulo" className="text-lg font-semibold">
                {s.title}
              </h2>
              <p className="text-xs text-muted">{s.lead}</p>
            </div>
          </div>

          {verdict && (
            <p
              className={`rounded-lg px-3 py-2 text-compact font-medium ${
                verdict.tone === "good"
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              }`}
            >
              {verdict.text}
            </p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-2xs font-medium uppercase tracking-[0.06em] text-muted">
                <th scope="col" className="pb-1.5 text-left font-medium">
                  <span className="sr-only">{s.title}</span>
                </th>
                <th scope="col" className="pb-1.5 text-right font-medium">
                  {s.planned}
                </th>
                <th scope="col" className="pb-1.5 text-right font-medium">
                  {s.actual}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-y border-line">
              {compared.map(([label, planned, actual]) => (
                <tr key={label}>
                  <th scope="row" className="py-2 text-left font-normal text-ink-2">
                    {label}
                  </th>
                  <td className="py-2 text-right tabular-nums text-muted">{planned}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{actual}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="grid grid-cols-3 gap-2">
            {single.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-sunken px-2.5 py-2">
                <dt className="text-2xs leading-tight text-muted">{label}</dt>
                <dd className="mt-0.5 text-md font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="focus-ring w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:bg-ink/85"
          >
            {t.common.close}
          </button>
        </div>
      )}
    </dialog>
  );
}
