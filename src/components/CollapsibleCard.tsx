"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface CollapsibleCardProps {
  id: string;
  title: string;
  /** Resumo curto mostrado quando o bloco está recolhido. */
  summary: string;
  open: boolean;
  onToggle: () => void;
  /** Classes extras de posicionamento (ex.: fixar o bloco em um canto no desktop). */
  className?: string;
  /**
   * "down": o bloco fica preso pela base e recolhe para baixo (a seta aponta
   * para baixo quando aberto). Padrão: "up", recolhe para cima.
   */
  collapseTo?: "up" | "down";
  /** Avisa a altura do bloco (px), já estabilizada depois da animação. */
  onHeightChange?: (height: number) => void;
  children: ReactNode;
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`h-4 w-4 shrink-0 transition-transform duration-300 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
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
  className = "",
  collapseTo = "up",
  onHeightChange,
  children,
}: CollapsibleCardProps) {
  const panelId = `${id}-painel`;
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = sectionRef.current;
    if (!element || !onHeightChange) return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      // Espera a animação terminar para não reenquadrar o mapa a cada quadro.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onHeightChange(Math.round(element.offsetHeight)), 350);
    });
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [onHeightChange]);

  return (
    <section
      ref={sectionRef}
      data-map-overlay
      className={`pointer-events-auto rounded-xl border border-zinc-200 bg-white/95 shadow-lg backdrop-blur transition-shadow duration-300 hover:shadow-xl motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-900/95 ${className}`}
    >
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 hover:bg-zinc-100/70 motion-reduce:transition-none dark:hover:bg-zinc-800/60"
        >
          <span className="shrink-0 text-sm font-semibold">{title}</span>
          <span
            className={`min-w-0 truncate text-xs text-zinc-600 transition-opacity duration-300 motion-reduce:transition-none dark:text-zinc-400 ${
              open ? "opacity-0" : "opacity-100"
            }`}
            aria-hidden={open}
          >
            {summary}
          </span>
          <span className={`ml-auto text-zinc-500 dark:text-zinc-400 ${collapseTo === "down" ? "rotate-180" : ""}`}>
            <Chevron open={open} />
          </span>
        </button>
      </h2>
      {/* Anima a altura com grid-template-rows (0fr ↔ 1fr), sem medir o conteúdo. */}
      <div
        id={panelId}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-3 pb-3 pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  );
}
