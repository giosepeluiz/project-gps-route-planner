"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HeaderDrag } from "./CollapsibleCard";
import { dropTarget, type DropTarget, type Rect, type Span } from "@/lib/block-layout";
import type { BlockId, BlockLayout } from "@/lib/settings";

/** Distância mínima (px) para um toque no título virar arrasto em vez de clique. */
const DRAG_THRESHOLD = 5;
/** Espaço entre os blocos de uma coluna (px), igual ao gap-3 da coluna. */
const COLUMN_GAP = 12;

export interface BlockDragState {
  id: BlockId;
  /** Onde o bloco está, seguindo o ponteiro. */
  rect: Rect;
  target: DropTarget;
}

/**
 * Arrastar os blocos pelo título. Enquanto arrasta, devolve o estado para o
 * HUD desenhar o bloco solto e o lugar onde ele vai cair; ao soltar, chama `onDrop`.
 */
export function useBlockDrag(layout: BlockLayout, onDrop: (id: BlockId, target: DropTarget) => void) {
  const elements = useRef(new Map<BlockId, HTMLElement>());
  const [drag, setDrag] = useState<BlockDragState | null>(null);
  const suppressClick = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const layoutRef = useRef(layout);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    layoutRef.current = layout;
    onDropRef.current = onDrop;
  });
  useEffect(() => () => cleanupRef.current?.(), []);

  const register = useCallback(
    (id: BlockId) => (element: HTMLElement | null) => {
      if (element) elements.current.set(id, element);
      else elements.current.delete(id);
    },
    [],
  );

  /**
   * Centro vertical dos outros blocos de cada coluna, medido no começo do
   * arrasto. Os que ficam abaixo do bloco arrastado sobem o espaço dele, porque
   * ele sai da coluna enquanto é arrastado.
   */
  const measureDocks = (id: BlockId, height: number) => {
    const result = { left: [] as number[], right: [] as number[] };
    const spans: { left: Span | null; right: Span | null } = { left: null, right: null };
    for (const side of ["left", "right"] as const) {
      const column = layoutRef.current[side];
      const from = column.indexOf(id);
      column.forEach((block, i) => {
        if (block === id) return;
        const box = elements.current.get(block)?.getBoundingClientRect();
        if (!box) return;
        const shift = from !== -1 && i > from ? height + COLUMN_GAP : 0;
        result[side].push(box.top + box.height / 2 - shift);
        const top = box.top - shift;
        const bottom = box.bottom - shift;
        const span = spans[side];
        spans[side] = span ? { top: Math.min(span.top, top), bottom: Math.max(span.bottom, bottom) } : { top, bottom };
      });
    }
    return { mids: result, spans };
  };

  const headerDrag = (id: BlockId): HeaderDrag => ({
    onPointerDown(event) {
      if (event.button !== 0 || !event.isPrimary) return;
      const element = elements.current.get(id);
      if (!element) return;
      const box = element.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let active = false;
      let last: BlockDragState | null = null;
      const { mids: dockMids, spans: dockSpans } = measureDocks(id, box.height);

      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!active) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          active = true;
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
        }
        const rect = { left: box.left + dx, top: box.top + dy, width: box.width, height: box.height };
        const target = dropTarget({
          rect,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          dockMids,
          dockSpans,
        });
        last = { id, rect, target };
        setDrag(last);
      };
      const finish = (commit: boolean) => {
        cleanup();
        if (!active) return;
        // O clique que vem logo depois do pointerup não deve abrir/fechar o bloco.
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
        setDrag(null);
        if (commit && last) onDropRef.current(id, last.target);
      };
      const up = (e: PointerEvent) => e.pointerId === pointerId && finish(true);
      const cancel = (e: PointerEvent) => e.pointerId === pointerId && finish(false);
      const key = (e: KeyboardEvent) => e.key === "Escape" && finish(false);
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        cleanupRef.current = null;
      };
      cleanupRef.current?.();
      cleanupRef.current = cleanup;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key);
    },
    onClickCapture(event) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return { drag, register, headerDrag };
}
