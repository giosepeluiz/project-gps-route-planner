"use client";

import { useEffect, useRef } from "react";

interface HelpMenuProps {
  /** Botão "?" que abriu o menu (o menu abre ao lado dele). */
  anchor: HTMLElement;
  onAbout: () => void;
  onClose: () => void;
}

/** Menu do botão "?": por enquanto, só a opção Sobre. */
export default function HelpMenu({ anchor, onAbout, onClose }: HelpMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const box = anchor.getBoundingClientRect();
  // Abre à esquerda do botão, alinhado pelo topo; perto da borda esquerda, abre embaixo.
  const openLeft = box.left > 220;
  const style = openLeft
    ? { top: box.top, right: window.innerWidth - box.left + 8 }
    : { top: box.bottom + 8, left: Math.max(8, box.left) };

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        anchor.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Ajuda"
      className="fixed z-40 min-w-40 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-panel"
      style={style}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onAbout();
        }}
        className="focus-ring flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-ink hover:bg-hover"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.5" />
          <circle cx="10" cy="6.4" r=".4" fill="currentColor" />
        </svg>
        Sobre
      </button>
    </div>
  );
}
