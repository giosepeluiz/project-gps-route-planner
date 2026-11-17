"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeBeside, type Placement } from "@/lib/floating";

interface InfoTipProps {
  /** Nome acessível do botão "i". */
  label: string;
  children: ReactNode;
}

/**
 * Botão "i" com uma dica: abre ao passar o mouse e fica aberta com um clique ou
 * toque. Fecha com outro clique, tocando fora, com Esc ou ao rolar a tela.
 */
export default function InfoTip({ label, children }: InfoTipProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /** "hover" some quando o mouse sai; "click" fica até fechar. */
  const [open, setOpen] = useState<"hover" | "click" | null>(null);
  const [position, setPosition] = useState<Placement | null>(null);

  const close = () => {
    setOpen(null);
    setPosition(null);
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const tip = tipRef.current;
      if (!anchor || !tip) return;
      setPosition(
        placeBeside(
          anchor,
          { width: tip.offsetWidth, height: tip.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
          ["bottom", "top", "left", "right"],
          8,
        ),
      );
    });
    const shut = () => {
      setOpen(null);
      setPosition(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !tipRef.current?.contains(target)) shut();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") shut();
    };
    window.addEventListener("resize", shut);
    window.addEventListener("scroll", shut, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", shut);
      window.removeEventListener("scroll", shut, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open !== null}
        aria-describedby={open ? id : undefined}
        onClick={() => (open === "click" ? close() : setOpen("click"))}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse" && !open) setOpen("hover");
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && open === "hover") close();
        }}
        className={`focus-ring grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors duration-150 motion-reduce:transition-none ${
          open ? "bg-sunken text-ink" : "text-muted hover:bg-hover hover:text-ink"
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.5" />
          <circle cx="10" cy="6.4" r=".4" fill="currentColor" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
            className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-surface px-3 py-2.5 text-xs leading-relaxed text-ink-2 shadow-panel"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
