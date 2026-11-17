"use client";

import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react";

/** Eventos do título quando o bloco pode ser arrastado por ele. */
export interface HeaderDrag {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  /** Cancela o clique (abrir/fechar) que vem no fim de um arrasto. */
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

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
  /** Arrastar pelo título (blocos soltos no desktop). */
  headerDrag?: HeaderDrag;
  /** Elemento do bloco, para medir posição durante o arrasto. */
  blockRef?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  children: ReactNode;
}

function MoveGrip() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
      {[6, 10, 14].flatMap((y) => [7.5, 12.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}
    </svg>
  );
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
  headerDrag,
  blockRef,
  style,
  children,
}: CollapsibleCardProps) {
  const panelId = `${id}-painel`;
  const sectionRef = useRef<HTMLElement | null>(null);

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
      ref={(element) => {
        sectionRef.current = element;
        blockRef?.(element);
      }}
      style={style}
      // Só o cartão solto conta como obstáculo para o balão do mapa; a seção já está dentro do painel.
      data-map-overlay={card ? "" : undefined}
      className={`pointer-events-auto ${
        card
          ? "flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-panel"
          : "border-t border-line first:border-t-0"
      } ${className}`}
    >
      <h2 className="shrink-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          {...headerDrag}
          title={headerDrag ? "Clique para abrir ou fechar. Arraste para mover o bloco." : undefined}
          className={`focus-ring group flex w-full items-center gap-2 px-4 py-3 text-left outline-offset-[-2px] transition-colors duration-150 hover:bg-hover motion-reduce:transition-none ${
            headerDrag ? "cursor-grab touch-none active:cursor-grabbing" : ""
          }`}
        >
          {headerDrag && (
            <span className="-ml-1.5 text-faint transition-colors group-hover:text-muted">
              <MoveGrip />
            </span>
          )}
          <span className="shrink-0 text-sm font-semibold text-ink">{title}</span>
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
        className={`grid min-h-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        {/* No cartão solto o conteúdo rola por dentro quando passa da altura da tela. */}
        <div className={`min-h-0 ${card && open ? "overflow-y-auto overscroll-contain" : "overflow-hidden"}`}>
          <div className="px-4 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
