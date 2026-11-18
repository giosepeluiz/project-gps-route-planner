"use client";

import { useSyncExternalStore } from "react";
import { useT } from "./I18nProvider";
import {
  GOOGLE_WAYPOINTS_DESKTOP,
  GOOGLE_WAYPOINTS_MOBILE,
  googleMapsLinks,
  navigationLinks,
  routeText,
  type NavigationApp,
} from "@/lib/export";
import type { Place, Plan } from "@/lib/types";

interface ActionsPanelProps {
  start: Place;
  /** Paradas na ordem da visita. */
  stops: readonly Place[];
  /** Paradas já concluídas: a próxima parada pula essas. */
  doneIds: ReadonlySet<string>;
  /** Ponto final (o próprio início em ida e volta) ou null. */
  finalPlace: Place | null;
  roundTrip: boolean;
  plan: Plan | null;
  /** true em telas estreitas: o Google Maps aceita menos paradas por link no celular. */
  isMobile: boolean;
  onNotify: (text: string) => void;
  /** Caminho do link compartilhável da rota (/r/…), ou null. */
  sharePath: string | null;
}

const subscribeNothing = () => () => {};

const linkClass =
  "focus-ring flex items-center justify-between gap-2 rounded-lg border border-line-strong px-2.5 py-2 text-sm font-medium transition-colors duration-200 hover:bg-hover motion-reduce:transition-none";

function External() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4h5v5M16 4l-7 7M8 5H5a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" />
    </svg>
  );
}

/**
 * Ícone de cada app no formato de ícone de aplicativo (quadrado arredondado),
 * todos do mesmo tamanho, só para reconhecer à primeira vista.
 */
function AppIcon({ id }: { id: NavigationApp["id"] }) {
  const tile = "h-8 w-8 rounded-[9px] shadow-[0_1px_2px_rgb(0_0_0/0.18)]";
  if (id === "google") {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32" className={tile}>
        <defs>
          <clipPath id="pino-google">
            <path d="M16 5.5c-4.4 0-7.8 3.4-7.8 7.7 0 5.8 7.8 13.3 7.8 13.3s7.8-7.5 7.8-13.3c0-4.3-3.4-7.7-7.8-7.7z" />
          </clipPath>
        </defs>
        <rect width="32" height="32" rx="9" fill="#ffffff" />
        <rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="#dadce0" />
        <g clipPath="url(#pino-google)">
          <rect x="0" y="0" width="16" height="13" fill="#1a73e8" />
          <rect x="16" y="0" width="16" height="13" fill="#ea4335" />
          <rect x="0" y="13" width="16" height="19" fill="#fbbc04" />
          <rect x="16" y="13" width="16" height="19" fill="#34a853" />
        </g>
        <circle cx="16" cy="13.2" r="2.9" fill="#ffffff" />
      </svg>
    );
  }
  if (id === "waze") {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32" className={tile}>
        <rect width="32" height="32" rx="9" fill="#33ccff" />
        <path
          d="M16.5 7c-5.2 0-9 3.4-9 7.7 0 1.6.5 3 1.4 4.2-.3 1.1-.9 1.9-1.8 2.4 1.7.4 3.2.1 4.4-.7 1.5.9 3.2 1.3 5 1.3 5.2 0 9-3.4 9-7.5S21.7 7 16.5 7z"
          fill="#ffffff"
          stroke="#0b2a3c"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <circle cx="13.6" cy="13.2" r="1.1" fill="#0b2a3c" />
        <circle cx="19.2" cy="13.2" r="1.1" fill="#0b2a3c" />
        <path d="M13.2 16.4c1.7 1.6 4.6 1.6 6.3 0" fill="none" stroke="#0b2a3c" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="12.4" cy="24.4" r="1.9" fill="#0b2a3c" />
        <circle cx="20.6" cy="24.4" r="1.9" fill="#0b2a3c" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={tile}>
      <defs>
        <linearGradient id="fundo-apple" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f6f2" />
          <stop offset="1" stopColor="#dcebd6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#fundo-apple)" />
      <path d="M-1 21.5L33 11" stroke="#ffffff" strokeWidth="3.2" />
      <path d="M11 -1l6 34" stroke="#f7c948" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="7.2" fill="#0a84ff" stroke="#ffffff" strokeWidth="1.6" />
      <path d="M16 11.6l3.4 8.2-3.4-1.9-3.4 1.9z" fill="#ffffff" strokeLinejoin="round" />
    </svg>
  );
}

export default function ActionsPanel({
  start,
  stops,
  doneIds,
  finalPlace,
  roundTrip,
  plan,
  isMobile,
  onNotify,
  sharePath,
}: ActionsPanelProps) {
  const t = useT();
  const sequence = finalPlace ? [start, ...stops, finalPlace] : [start, ...stops];
  const maxWaypoints = isMobile ? GOOGLE_WAYPOINTS_MOBILE : GOOGLE_WAYPOINTS_DESKTOP;
  const links = googleMapsLinks(sequence, maxWaypoints);
  // Próxima parada: a primeira ainda não concluída; com todas feitas, o fim (ou a volta ao início).
  const pending = stops.find((s) => !doneIds.has(s.id));
  const allDone = stops.length > 0 && !pending;
  const next =
    pending ?? (finalPlace && (finalPlace.id !== start.id || allDone) ? finalPlace : null);
  const nextIsReturn = !pending && next?.id === start.id;
  const text = plan ? routeText(start, plan, stops.length, roundTrip, links, t.routeText) : null;
  // Só existe no navegador (e nem em todos): no servidor vale false.
  const canShare = useSyncExternalStore(
    subscribeNothing,
    () => typeof navigator.share === "function",
    () => false,
  );

  /** Endereço completo do link (só no navegador, no clique). */
  const shareUrl = () => (sharePath ? `${window.location.origin}${sharePath}` : null);

  const copyLink = async () => {
    const url = shareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      onNotify(t.actions.linkCopied);
    } catch {
      onNotify(t.actions.copyFailed);
    }
  };

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      onNotify(t.actions.copied);
    } catch {
      onNotify(t.actions.copyFailed);
    }
  };

  const share = async () => {
    if (!text) return;
    try {
      const url = shareUrl();
      await navigator.share({ title: t.actions.shareTitle, text, ...(url ? { url } : {}) });
    } catch {
      // O usuário fechou a folha de compartilhamento: nada a fazer.
    }
  };

  if (links.length === 0) {
    return (
      <p className="text-sm text-muted">{t.actions.needStops}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {links.map((link, i) => (
        <a key={link} href={link} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <span>
            {t.actions.openGoogle}
            {links.length > 1 && (
              <span className="block text-xs font-normal text-muted">{t.actions.part(i + 1, links.length)}</span>
            )}
          </span>
          <External />
        </a>
      ))}
      {links.length > 1 && (
        <p className="text-xs text-muted">{t.actions.split(maxWaypoints, isMobile)}</p>
      )}

      {next && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line-strong px-2.5 py-2">
          <span className="min-w-0 text-sm font-medium">
            {nextIsReturn ? t.actions.navigateBack : t.actions.navigateNext}
            <span className="block truncate text-xs font-normal text-muted">{next.label}</span>
          </span>
          <span className="flex shrink-0 gap-1">
            {navigationLinks(next).map((app) => (
              <a
                key={app.id}
                href={app.href}
                target="_blank"
                rel="noopener noreferrer"
                title={t.actions.navigateWith(app.name)}
                aria-label={t.actions.navigateTo(next.label, app.name)}
                className="focus-ring grid h-10 w-10 place-items-center rounded-xl transition-[background-color,transform] duration-150 hover:bg-hover active:scale-95 motion-reduce:transition-none"
              >
                <AppIcon id={app.id} />
              </a>
            ))}
          </span>
        </div>
      )}

      {sharePath && (
        <button type="button" onClick={() => void copyLink()} className={`${linkClass} justify-center`}>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 11.5a3 3 0 004.2.2l2.5-2.5a3 3 0 00-4.2-4.2l-1 1" />
            <path d="M11.5 8.5a3 3 0 00-4.2-.2L4.8 10.8a3 3 0 004.2 4.2l1-1" />
          </svg>
          {t.actions.copyLink}
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!text}
          className={`${linkClass} justify-center disabled:cursor-not-allowed disabled:opacity-50 ${canShare ? "" : "col-span-2"}`}
        >
          {t.actions.copy}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => void share()}
            disabled={!text}
            className={`${linkClass} justify-center disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {t.actions.share}
          </button>
        )}
      </div>
    </div>
  );
}
