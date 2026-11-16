import type { ReactNode } from "react";

interface CollapsibleCardProps {
  id: string;
  title: string;
  /** Resumo curto mostrado quando o bloco está recolhido. */
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

export default function CollapsibleCard({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: CollapsibleCardProps) {
  const panelId = `${id}-painel`;
  return (
    <section className="pointer-events-auto rounded-xl border border-zinc-200 bg-white/95 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left"
        >
          <span className="shrink-0 text-sm font-semibold">{title}</span>
          {!open && (
            <span className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-400">
              {summary}
            </span>
          )}
          <span className="ml-auto text-zinc-500 dark:text-zinc-400">
            <Chevron open={open} />
          </span>
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="px-3 pb-3">
        {children}
      </div>
    </section>
  );
}
