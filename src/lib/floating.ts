/** Posição de um balão flutuante (dica, tutorial) ao lado de um elemento da tela. */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Side = "right" | "left" | "bottom" | "top";

export interface Placement {
  top: number;
  left: number;
  side: Side;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Primeiro lado (na ordem pedida) em que o balão cabe inteiro na tela. Se não
 * couber em nenhum, fica no primeiro lado, preso dentro da tela.
 */
export function placeBeside(
  anchor: Box,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  order: readonly Side[] = ["right", "left", "bottom", "top"],
  gap = 12,
  margin = 8,
): Placement {
  const fits: Record<Side, boolean> = {
    right: anchor.left + anchor.width + gap + tip.width <= viewport.width - margin,
    left: anchor.left - gap - tip.width >= margin,
    bottom: anchor.top + anchor.height + gap + tip.height <= viewport.height - margin,
    top: anchor.top - gap - tip.height >= margin,
  };
  const side = order.find((s) => fits[s]) ?? order[0];
  const vertical = clamp(anchor.top, margin, viewport.height - tip.height - margin);
  const horizontal = clamp(anchor.left + anchor.width / 2 - tip.width / 2, margin, viewport.width - tip.width - margin);
  switch (side) {
    case "right":
      return { side, top: vertical, left: clamp(anchor.left + anchor.width + gap, margin, viewport.width - tip.width - margin) };
    case "left":
      return { side, top: vertical, left: clamp(anchor.left - gap - tip.width, margin, viewport.width - tip.width - margin) };
    case "bottom":
      return { side, left: horizontal, top: clamp(anchor.top + anchor.height + gap, margin, viewport.height - tip.height - margin) };
    case "top":
      return { side, left: horizontal, top: clamp(anchor.top - gap - tip.height, margin, viewport.height - tip.height - margin) };
  }
}
