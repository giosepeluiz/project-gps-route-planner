/**
 * Margens do enquadramento da rota no desktop, a partir dos blocos que estão
 * de fato sobre o mapa. Cada bloco é tirado pela borda que custa menos área:
 * um Resumo alto e estreito no canto sai pela lateral, não pela base inteira.
 */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Folga mínima em volta da rota e entre a rota e um bloco (px). */
export const BASE_PADDING = 48;
export const OVERLAY_GAP = 32;

export function overlayPadding(map: Box, overlays: readonly Box[]): Padding {
  const width = map.right - map.left;
  const height = map.bottom - map.top;
  const pad: Padding = { top: BASE_PADDING, bottom: BASE_PADDING, left: BASE_PADDING, right: BASE_PADDING };
  for (const r of overlays) {
    const left = r.left - map.left;
    const right = r.right - map.left;
    const top = r.top - map.top;
    const bottom = r.bottom - map.top;
    if (right <= left || bottom <= top) continue;
    if (right <= 0 || left >= width || bottom <= 0 || top >= height) continue;
    const options = [
      { side: "left" as const, px: right, cost: right / width },
      { side: "right" as const, px: width - left, cost: (width - left) / width },
      { side: "top" as const, px: bottom, cost: bottom / height },
      { side: "bottom" as const, px: height - top, cost: (height - top) / height },
    ];
    const cheapest = options.reduce((a, b) => (b.cost < a.cost ? b : a));
    pad[cheapest.side] = Math.max(pad[cheapest.side], cheapest.px + OVERLAY_GAP);
  }
  return pad;
}
