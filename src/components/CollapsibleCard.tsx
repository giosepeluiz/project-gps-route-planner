"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface CollapsibleCardProps {
  id: string;
  title: string;
  /** Resumo curto mostrado quando o bloco está recolhido. */
  summary: string;
  open: boolean;
  onToggle: () => void;
  /**
   * "section": parte do painel, separada das vizinhas por uma linha fina.
   * "card": bloco solto sobre o mapa, com fundo, borda e sombra próprios.
   */
  variant?: "section" | "card";
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
      className={`h-4 w-4 shrink-0 transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8l4 4 4-4" />
    </svg>
  );
}

export default function CollapsibleCard({
  id,
  title,
  summary,
  open,
  onToggle,
  variant = "section",
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

  const card = variant === "card";

  return (
    <section
      ref={sectionRef}
      // Só o cartão solto conta como obstáculo para o balão do mapa; a seção já está dentro do painel.
      data-map-overlay={card ? "" : undefined}
      className={`pointer-events-auto ${
        card
          ? "overflow-hidden rounded-xl border border-line bg-surface shadow-panel"
          : "border-t border-line first:border-t-0"
      } ${className}`}
    >
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="focus-ring group flex w-full items-center gap-2 px-4 py-3 text-left outline-offset-[-2px] transition-colors duration-150 hover:bg-hover motion-reduce:transition-none"
        >
          <span className="shrink-0 text-[13px] font-semibold text-ink">{title}</span>
          <span
            className={`min-w-0 truncate text-xs text-muted transition-opacity duration-200 motion-reduce:transition-none ${
              open ? "opacity-0" : "opacity-100"
            }`}
            aria-hidden={open}
          >
            {summary}
          </span>
          <span
            className={`ml-auto text-faint transition-colors group-hover:text-ink ${collapseTo === "down" ? "rotate-180" : ""}`}
          >
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
          <div className="px-4 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
