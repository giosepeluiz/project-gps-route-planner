import type { ReactNode } from "react";
import { formatLatLng } from "@/lib/format";

interface Action {
  /** Texto do círculo à esquerda: número da parada, "A" ou "B". */
  badge: string;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

interface PlacePopupProps {
  /** Nome do local, ou null enquanto o endereço não chega. */
  title: string | null;
  /** Papel na rota ("Início da rota", "Parada 2"…), para locais que já estão nela. */
  role?: string;
  /** undefined = buscando; null = não encontrado. */
  address: string | null | undefined;
  lat: number;
  lng: number;
  onCopy: () => void;
  actions: Action[];
  /** Ação secundária no rodapé (ex.: remover parada). */
  footer?: ReactNode;
}

function Pin() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M10 1.5a6 6 0 00-6 6c0 4.2 4.9 9.5 5.5 10.2a.7.7 0 001 0C11.100 17 16 11.700 16 7.500a6 6 0 00-6-6zm0 8.200a2.200 2.200 0 110-4.400 2.200 2.200 0 010 4.400z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Balão do clique no mapa: mostra o local e pergunta o que fazer com ele. */
export default function PlacePopup({
  title,
  role,
  address,
  lat,
  lng,
  onCopy,
  actions,
  footer,
}: PlacePopupProps) {
  const loading = address === undefined;
  const heading = title ?? (loading ? null : "Local sem endereço");

  return (
    <div className="flex w-64 max-w-full flex-col gap-3 text-sm text-zinc-900 dark:text-zinc-100">
      <header className="flex items-start gap-2.5 pr-5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          <Pin />
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          {role && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              {role}
            </p>
          )}
          {heading ? (
            <p className="font-semibold leading-snug">{heading}</p>
          ) : (
            // Enquanto o endereço não chega, um traço pulsando no lugar do título.
            <p className="h-4 w-40 animate-pulse rounded bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-700">
              <span className="sr-only">Buscando o endereço…</span>
            </p>
          )}
          {role && address && address !== title && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{address}</p>
          )}
          <button
            type="button"
            onClick={onCopy}
            title="Copiar coordenadas"
            className="focus-ring mt-0.5 flex items-center gap-1 rounded font-mono text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {formatLatLng(lat, lng)}
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="7" y="7" width="9" height="9" rx="1.500" />
              <path d="M4 13V5a1 1 0 011-1h8" />
            </svg>
            <span className="sr-only">Copiar coordenadas</span>
          </button>
        </div>
      </header>

      {actions.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            O que fazer com este local?
          </p>
          {actions.map((action) => (
            <button
              key={action.title}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`focus-ring flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
                action.primary
                  ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                  : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  action.primary
                    ? "bg-white text-blue-700"
                    : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                }`}
              >
                {action.badge}
              </span>
              <span className="min-w-0">
                <span className="block font-medium leading-tight">{action.title}</span>
                <span
                  className={`block truncate text-xs ${
                    action.primary ? "text-blue-100" : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  {action.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {footer}
    </div>
  );
}
