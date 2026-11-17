"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "./I18nProvider";
import { placeBeside, type Box, type Placement, type Side } from "@/lib/floating";

export interface TourStep {
  /** Seletor CSS do elemento explicado. */
  target: string;
  text: string;
  /** Lados preferidos para o balão (o padrão é direita, esquerda, baixo, cima). */
  prefer?: Side[];
}

interface TourProps {
  steps: TourStep[];
  /** Chamado antes de mostrar cada passo (ex.: abrir a gaveta no celular). */
  onStep?: (index: number) => void;
  /** Fim do tutorial, concluído ou pulado. */
  onClose: () => void;
}

/** Atraso antes do primeiro passo: dá tempo do mapa e dos blocos aparecerem. */
const START_DELAY_MS = 700;
/** O balão acompanha o elemento enquanto ele anima, rola ou muda de tamanho. */
const FOLLOW_MS = 250;
const TOUR_BLUE = "#2563eb";

interface Layout {
  ring: Box | null;
  tip: Placement;
  /** Posição da setinha ao longo da borda do balão (px). */
  arrow: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** Tutorial do primeiro uso: balões azuis apontando cada parte da tela. */
export default function Tour({ steps, onStep, onClose }: TourProps) {
  const t = useT();
  const [index, setIndex] = useState<number | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(-1);
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  });

  // Começa depois de um instante.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onStepRef.current?.(0);
      setIndex(0);
    }, START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const step = index === null ? null : steps[index];

  // Mede o elemento do passo e posiciona o balão ao lado dele.
  useEffect(() => {
    if (!step || index === null) return;
    const measure = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const tip = tipRef.current;
      const size = { width: tip?.offsetWidth ?? 288, height: tip?.offsetHeight ?? 170 };
      const element = document.querySelector<HTMLElement>(step.target);
      const box = element?.getBoundingClientRect();
      let next: Layout;
      if (!element || !box || box.width === 0 || box.height === 0) {
        // Sem o elemento na tela: balão no centro, embaixo.
        next = {
          ring: null,
          tip: {
            side: "bottom",
            left: (viewport.width - size.width) / 2,
            top: viewport.height - size.height - 24,
          },
          arrow: -1,
        };
      } else {
        if (scrolledRef.current !== index) {
          scrolledRef.current = index;
          element.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        // Em tela estreita (blocos na largura toda, na gaveta), aponta para o título
        // do bloco, com o balão acima dele, sobre o mapa, sem cobrir o conteúdo.
        const narrow = viewport.width < 768;
        const header = narrow ? element.querySelector("h2")?.getBoundingClientRect() : undefined;
        const anchor = header && header.height > 0 ? header : box;
        const tipAt = placeBeside(anchor, size, viewport, narrow ? ["top", "bottom"] : step.prefer);
        const arrow =
          tipAt.side === "left" || tipAt.side === "right"
            ? clamp(Math.min(anchor.top + 22, anchor.top + anchor.height / 2) - tipAt.top, 14, size.height - 14)
            : clamp(anchor.left + anchor.width / 2 - tipAt.left, 16, size.width - 16);
        next = {
          ring: { top: box.top, left: box.left, width: box.width, height: box.height },
          tip: tipAt,
          arrow,
        };
      }
      setLayout((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    const frame = window.requestAnimationFrame(measure);
    const timer = window.setInterval(measure, FOLLOW_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [step, index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!step || index === null) return null;
  const last = index === steps.length - 1;
  const go = (next: number) => {
    onStep?.(next);
    setIndex(next);
  };

  const arrowStyle = (() => {
    if (!layout || layout.arrow < 0) return null;
    const { side } = layout.tip;
    const base = { backgroundColor: TOUR_BLUE };
    if (side === "right") return { ...base, left: -5, top: layout.arrow - 5 };
    if (side === "left") return { ...base, right: -5, top: layout.arrow - 5 };
    if (side === "bottom") return { ...base, top: -5, left: layout.arrow - 5 };
    return { ...base, bottom: -5, left: layout.arrow - 5 };
  })();

  return createPortal(
    <>
      {layout?.ring && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-xl transition-all duration-200 motion-reduce:transition-none"
          style={{
            top: layout.ring.top - 3,
            left: layout.ring.left - 3,
            width: layout.ring.width + 6,
            height: layout.ring.height + 6,
            boxShadow: `0 0 0 2px ${TOUR_BLUE}, 0 0 0 6px rgb(37 99 235 / 0.22)`,
          }}
        />
      )}
      <div
        ref={tipRef}
        role="dialog"
        aria-label={t.tour.step(index + 1, steps.length)}
        aria-live="polite"
        style={
          layout
            ? { top: layout.tip.top, left: layout.tip.left, backgroundColor: TOUR_BLUE }
            : { top: 0, left: 0, visibility: "hidden", backgroundColor: TOUR_BLUE }
        }
        className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] rounded-xl px-4 py-3.5 text-white shadow-[0_12px_32px_rgb(15_23_42/0.35)] transition-[top,left] duration-200 motion-reduce:transition-none"
      >
        {arrowStyle && <span aria-hidden="true" className="absolute h-2.5 w-2.5 rotate-45" style={arrowStyle} />}
        <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-white/75">
          {t.tour.step(index + 1, steps.length)}
        </p>
        <p className="mt-1 text-compact leading-relaxed">{step.text}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-1.5 py-1 text-xs font-medium text-white/85 outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
          >
            {t.tour.skip}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => (last ? onClose() : go(index + 1))}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold outline-none hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#2563eb]"
            style={{ color: TOUR_BLUE }}
          >
            {last ? t.tour.done : t.tour.next}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
