"use client";

import { apiUrl } from "@/lib/api-base";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import pkg from "../../package.json";
import { useT } from "./I18nProvider";
import { formatDuration, formatKm, formatTime } from "@/lib/format";
import type { TripSummary } from "@/lib/trip";
import { collectDevice } from "@/lib/device-info";
import type { Locale } from "@/lib/i18n";
import type { FontSize } from "@/lib/settings";
import { isTrivialTrip, REPORT_COOLDOWN_MS, reportText, TripReport } from "@/lib/trip-report";

const SENT_KEY = "rotas:relatorio:enviado";
/** Relógio para cliques e respostas (fora da renderização). */
const nowMs = () => Date.now();

/** Momento do último envio deste aparelho (ms), ou 0. */
function lastSentAt(): number {
  try {
    return Number(window.localStorage.getItem(SENT_KEY)) || 0;
  } catch {
    return 0;
  }
}

interface TripStatsDialogProps {
  open: boolean;
  stats: TripSummary | null;
  /** Números da viagem para as estatísticas anônimas (o aparelho é lido aqui). */
  reportTrip: TripReport["trip"] | null;
  locale: Locale;
  theme: "light" | "dark";
  fontSize: FontSize;
  onClose: () => void;
  /** Gera o relatório final (documento para imprimir ou salvar em PDF). */
  onFinalReport?: () => Promise<void>;
}

type SendState = "ask" | "sending" | "sent" | "failed" | "unavailable";

const Email = z.email().max(254);

/** Estatísticas da viagem concluída: previsto × real. */
export default function TripStatsDialog({
  open,
  stats,
  reportTrip,
  locale,
  theme,
  fontSize,
  onClose,
  onFinalReport,
}: TripStatsDialogProps) {
  const t = useT();
  const s = t.trip.stats;
  const r = t.trip.report;
  const ref = useRef<HTMLDialogElement>(null);
  const copyId = useId();
  const emailId = useId();
  const [device, setDevice] = useState<TripReport["device"] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<SendState>("ask");
  const [wantCopy, setWantCopy] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [preview, setPreview] = useState(false);
  /** Baixando o relatório final (espera o PDF terminar de ficar pronto). */
  const [pdfBusy, setPdfBusy] = useState(false);
  /** false nos 30 min seguintes a um envio deste aparelho. */
  const [nowAllowed, setNowAllowed] = useState(true);

  // Ao abrir: lê o aparelho e pergunta ao servidor se o envio está ligado.
  useEffect(() => {
    if (!open || !reportTrip) return;
    let cancelled = false;
    void collectDevice(theme, fontSize).then((d) => {
      if (cancelled) return;
      setDevice(d);
      setNowAllowed(nowMs() - lastSentAt() >= REPORT_COOLDOWN_MS);
    });
    void fetch(apiUrl("/api/status"))
      .then((res) => (res.ok ? (res.json() as Promise<{ tripReport?: boolean }>) : null))
      .then((status) => {
        if (!cancelled) setAvailable(status?.tripReport === true);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reportTrip, theme, fontSize]);

  const report: TripReport | null =
    reportTrip && device ? { appVersion: pkg.version, locale, trip: reportTrip, device } : null;
  // Some por 30 min depois de um envio, e não aparece para viagens quase vazias.
  const valid =
    report !== null &&
    TripReport.safeParse(report).success &&
    !isTrivialTrip(report.trip) &&
    (state === "sent" || available === null || nowAllowed);

  const send = async () => {
    if (!report) return;
    const copyTo = wantCopy ? email.trim() : null;
    if (copyTo !== null && !Email.safeParse(copyTo).success) {
      setEmailError(true);
      return;
    }
    setState("sending");
    try {
      const res = await fetch(apiUrl("/api/trip-report"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, copyTo }),
      });
      setState(res.ok ? "sent" : res.status === 503 ? "unavailable" : "failed");
      // Também conta como enviado quando o servidor recusa por excesso (429): espera 30 min.
      if (res.ok || res.status === 429) {
        try {
          window.localStorage.setItem(SENT_KEY, String(nowMs()));
        } catch {
          // Sem localStorage: o servidor continua bloqueando por IP.
        }
      }
    } catch {
      setState("failed");
    }
  };

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
      className="m-auto w-[min(26rem,calc(100vw-2rem))] lg:w-[min(33rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/50"
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

          {reportTrip && available && valid && (
            <section aria-labelledby="estatisticas-envio" className="flex flex-col gap-2.5 rounded-xl border border-line p-3.5">
              <h3 id="estatisticas-envio" className="text-sm font-semibold">
                {r.title}
              </h3>
              {state === "sent" ? (
                <p role="status" className="text-compact text-emerald-700 dark:text-emerald-400">
                  {r.sent}
                </p>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-ink-2">{r.body}</p>
                  <button
                    type="button"
                    aria-expanded={preview}
                    onClick={() => setPreview((v) => !v)}
                    className="focus-ring self-start text-xs font-medium text-accent hover:underline"
                  >
                    {r.preview}
                  </button>
                  {preview && report && (
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken p-2.5 text-2xs leading-relaxed text-ink-2">
                      {reportText(report)}
                    </pre>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={copyId} className="text-compact text-ink-2">
                      {r.copy}
                    </label>
                    <button
                      id={copyId}
                      type="button"
                      role="switch"
                      aria-checked={wantCopy}
                      onClick={() => setWantCopy((v) => !v)}
                      className={`focus-ring relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none ${
                        wantCopy ? "bg-accent" : "bg-line-strong"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-200 motion-reduce:transition-none ${
                          wantCopy ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                  </div>
                  {wantCopy && (
                    <div className="flex flex-col gap-1">
                      <label htmlFor={emailId} className="text-xs font-medium text-ink-2">
                        {r.email}
                      </label>
                      <input
                        id={emailId}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        maxLength={254}
                        value={email}
                        aria-invalid={emailError || undefined}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setEmailError(false);
                        }}
                        className="focus-ring w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                      <p className={`text-2xs ${emailError ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
                        {emailError ? r.invalidEmail : r.emailNote}
                      </p>
                    </div>
                  )}
                  {(state === "failed" || state === "unavailable") && (
                    <p role="alert" className="text-xs text-red-700 dark:text-red-400">
                      {state === "failed" ? r.failed : r.unavailable}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="focus-ring flex-1 rounded-lg border border-line-strong px-3 py-2 text-compact font-medium text-ink-2 hover:bg-hover"
                    >
                      {r.notNow}
                    </button>
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={state === "sending"}
                      className="focus-ring flex-1 rounded-lg bg-accent px-3 py-2 text-compact font-semibold text-white hover:bg-accent/90 disabled:opacity-60 dark:text-[#10131c]"
                    >
                      {state === "sending" ? r.sending : r.send}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {onFinalReport && reportTrip && (
            <button
              type="button"
              disabled={pdfBusy}
              onClick={() => {
                setPdfBusy(true);
                void onFinalReport().finally(() => setPdfBusy(false));
              }}
              className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:bg-hover disabled:cursor-wait disabled:opacity-60"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2.75h5.5L15.25 6.5v10a.75.75 0 01-.75.75h-8.5a.75.75 0 01-.75-.75V3.5A.75.75 0 016 2.75z" />
                <path d="M11.25 2.75V6.75h4M8 10.5h4.5M8 13.5h4.5" />
              </svg>
              {pdfBusy ? t.actions.reportPreparing : t.trip.stats.finalReport}
            </button>
          )}
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
