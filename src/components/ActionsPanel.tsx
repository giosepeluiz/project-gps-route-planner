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

/** Ícone de cada app, nas cores da marca, só para reconhecer à primeira vista. */
function AppIcon({ id }: { id: NavigationApp["id"] }) {
  if (id === "google") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6">
        <path d="M12 2.5a6.5 6.5 0 00-6.5 6.5c0 4.8 6.5 12.5 6.5 12.5s6.5-7.7 6.5-12.5A6.5 6.5 0 0012 2.5z" fill="#ea4335" />
        <path d="M5.9 6.9A6.5 6.5 0 0012 2.5v4a2.5 2.5 0 00-2.4 1.6z" fill="#4285f4" />
        <path d="M5.5 9c0 1.6.7 3.4 1.7 5.2l3.4-4a2.5 2.5 0 01-1-2.1l-3.7-1.2A6.5 6.5 0 005.5 9z" fill="#fbbc04" />
        <path d="M7.2 14.2c1.9 3.4 4.8 7.3 4.8 7.3V11.5a2.5 2.5 0 01-1.4-.4z" fill="#34a853" />
        <circle cx="12" cy="9" r="2.5" fill="#fff" />
      </svg>
    );
  }
  if (id === "waze") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6">
        <path d="M12 3c-5 0-8.5 3.4-8.5 7.7 0 1.6.5 3 1.3 4.1-.2 1-.8 1.8-1.6 2.3 1.6.4 3 .1 4.2-.6 1.4.8 3 1.2 4.6 1.2 5 0 8.5-3.4 8.5-7.6S17 3 12 3z" fill="#33ccff" stroke="#1b1a18" strokeWidth="1.2" />
        <circle cx="9.3" cy="9.6" r="1" fill="#1b1a18" />
        <circle cx="14.7" cy="9.6" r="1" fill="#1b1a18" />
        <path d="M9 12.6c1.6 1.6 4.4 1.6 6 0" fill="none" stroke="#1b1a18" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8" cy="19.6" r="1.6" fill="#1b1a18" />
        <circle cx="15.5" cy="19.6" r="1.6" fill="#1b1a18" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#e7f0e3" stroke="#c9d6c3" />
      <path d="M2.5 14.5l9-4 10 5" fill="none" stroke="#f5c542" strokeWidth="2" />
      <path d="M12 6.5l4.5 10.5-4.5-2.4-4.5 2.4z" fill="#0a84ff" />
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
      await navigator.share({ title: t.actions.shareTitle, text });
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
                className="focus-ring grid h-9 w-9 place-items-center rounded-lg transition-colors duration-150 hover:bg-hover motion-reduce:transition-none"
              >
                <AppIcon id={app.id} />
              </a>
            ))}
          </span>
        </div>
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
