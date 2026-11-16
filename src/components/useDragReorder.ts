"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface Drag {
  index: number;
  startY: number;
  dy: number;
  /** Altura de uma linha da lista, com o espaçamento. */
  rowHeight: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Arrastar e soltar em uma lista vertical, com mouse, dedo ou teclado
 * (setas para cima e para baixo na alça).
 */
export function useDragReorder(
  count: number,
  onMove: (from: number, to: number) => void,
  gapPx = 4,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const rows = useRef(new Map<number, HTMLElement>());

  const target = drag ? clamp(drag.index + Math.round(drag.dy / drag.rowHeight), 0, count - 1) : null;

  /** Deslocamento visual de cada linha enquanto outra é arrastada. */
  const offsetOf = (i: number): number => {
    if (!drag || target === null) return 0;
    if (i === drag.index) return drag.dy;
    if (drag.index < target && i > drag.index && i <= target) return -drag.rowHeight;
    if (drag.index > target && i < drag.index && i >= target) return drag.rowHeight;
    return 0;
  };

  const finish = (commit: boolean) => {
    if (drag && commit && target !== null && target !== drag.index) onMove(drag.index, target);
    setDrag(null);
  };

  /** Guarda o elemento da linha i (para medir a altura). */
  const rowRef = (i: number) => (element: HTMLElement | null) => {
    if (element) rows.current.set(i, element);
    else rows.current.delete(i);
  };

  /** Props da alça de arrastar da linha i. */
  const handleProps = (i: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const row = rows.current.get(i);
      if (!row) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        index: i,
        startY: event.clientY,
        dy: 0,
        rowHeight: row.getBoundingClientRect().height + gapPx,
      });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (drag?.index !== i) return;
      setDrag((current) => (current ? { ...current, dy: event.clientY - current.startY } : current));
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "ArrowUp" && i > 0) {
        event.preventDefault();
        onMove(i, i - 1);
      } else if (event.key === "ArrowDown" && i < count - 1) {
        event.preventDefault();
        onMove(i, i + 1);
      }
    },
  });

  return {
    /** Índice da linha sendo arrastada, ou null. */
    draggingIndex: drag?.index ?? null,
    offsetOf,
    rowRef,
    handleProps,
    gapPx,
  };
}

/** Classes da linha: destaque na que está sendo arrastada, transição nas demais. */
export function dragRowClass(isDragging: boolean, anyDragging: boolean): string {
  if (isDragging) {
    return "z-10 bg-white shadow-lg ring-1 ring-zinc-300 dark:bg-zinc-800 dark:ring-zinc-600";
  }
  return `${anyDragging ? "transition-transform duration-150" : "transition-colors duration-200"} motion-reduce:transition-none hover:bg-zinc-100 dark:hover:bg-zinc-800/70`;
}
