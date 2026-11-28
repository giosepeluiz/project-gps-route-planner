/**
 * Arrastar e soltar os blocos do HUD (telas largas).
 *
 * - Perto da borda esquerda ou direita, o bloco gruda numa coluna daquele lado,
 *   empilhado com os outros na posição em que foi solto.
 * - Perto do topo ou da base, ele gruda na margem (o "ímã" vertical).
 * - No resto da tela, fica solto onde foi largado, sempre inteiro na tela.
 */
import { EDGE_MARGIN, type BlockId, type BlockLayout, type FreePosition } from "./settings";

/** Distância (px) até a margem em que o ímã puxa o bloco. */
export const SNAP_DISTANCE = 40;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type DropTarget =
  | { kind: "dock"; side: "left" | "right"; index: number }
  | { kind: "free"; position: FreePosition };

export interface DropInput {
  /** Onde o bloco está agora (já seguindo o ponteiro). */
  rect: Rect;
  viewport: { width: number; height: number };
  /** Centro vertical dos outros blocos de cada coluna, em ordem. */
  dockMids: { left: number[]; right: number[] };
  /**
   * Faixa vertical (topo e base) ocupada pelos blocos de cada coluna, ou null se
   * a coluna está vazia. Sem ela, perto da borda o bloco sempre gruda na coluna.
   */
  dockSpans?: { left: Span | null; right: Span | null };
}

export interface Span {
  top: number;
  bottom: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Decide onde o bloco cai e com qual ímã. */
export function dropTarget({ rect, viewport, dockMids, dockSpans }: DropInput): DropTarget {
  const right = rect.left + rect.width;
  const centerY = rect.top + rect.height / 2;
  const reach = EDGE_MARGIN + SNAP_DISTANCE;

  const nearLeft = rect.left <= reach;
  const nearRight = viewport.width - right <= reach;
  if (nearLeft || nearRight) {
    // Se couber nos dois lados (tela estreita), vence a borda mais próxima.
    const side = nearLeft && nearRight ? (rect.left <= viewport.width - right ? "left" : "right") : nearLeft ? "left" : "right";
    const mids = dockMids[side];
    // Só empilha se for solto sobre (ou colado em) outros blocos da coluna; longe deles
    // o bloco fica solto na borda, no ponto onde foi largado (ex.: no canto de baixo).
    const span = dockSpans?.[side];
    const reachesColumn = !dockSpans || (!!span && centerY >= span.top - rect.height / 2 && centerY <= span.bottom + rect.height / 2);
    if (reachesColumn) {
      const index = mids.filter((mid) => mid < centerY).length;
      return { kind: "dock", side, index };
    }
  }

  // Solto: inteiro na tela e preso à borda mais próxima de cada eixo.
  const maxX = viewport.width - rect.width - EDGE_MARGIN;
  const maxY = viewport.height - rect.height - EDGE_MARGIN;
  const left = clamp(rect.left, EDGE_MARGIN, maxX);
  const top = clamp(rect.top, EDGE_MARGIN, maxY);
  const h = left + rect.width / 2 <= viewport.width / 2 ? "left" : "right";
  const v = top + rect.height / 2 <= viewport.height / 2 ? "top" : "bottom";
  let x = h === "left" ? left : viewport.width - (left + rect.width);
  let y = v === "top" ? top : viewport.height - (top + rect.height);
  // Ímã vertical (e horizontal, para o caso de a coluna não ter sido escolhida).
  if (y <= reach) y = EDGE_MARGIN;
  if (x <= reach) x = EDGE_MARGIN;
  return { kind: "free", position: { h, x: Math.round(x), v, y: Math.round(y) } };
}

/** Tira o bloco de onde estiver e põe no destino. */
export function placeBlock(layout: BlockLayout, id: BlockId, target: DropTarget): BlockLayout {
  const left = layout.left.filter((b) => b !== id);
  const right = layout.right.filter((b) => b !== id);
  const free = { ...layout.free };
  delete free[id];

  if (target.kind === "dock") {
    const column = target.side === "left" ? left : right;
    column.splice(clamp(target.index, 0, column.length), 0, id);
  } else {
    free[id] = target.position;
  }
  return { left, right, free };
}

/** Estilo de posição de um bloco solto. */
export function freeStyle(position: FreePosition): Record<string, number> {
  return {
    [position.h]: position.x,
    [position.v]: position.y,
  };
}

/** Retângulo (na tela) de um bloco solto, dado o seu tamanho. */
export function freeRect(position: FreePosition, size: { width: number; height: number }, viewport: { width: number; height: number }): Rect {
  const left = position.h === "left" ? position.x : viewport.width - position.x - size.width;
  const top = position.v === "top" ? position.y : viewport.height - position.y - size.height;
  return { left, top, width: size.width, height: size.height };
}

/** Ordem dos blocos na gaveta do celular: coluna esquerda, direita e depois os soltos (de cima para baixo). */
export function sheetOrder(layout: BlockLayout, all: readonly BlockId[]): BlockId[] {
  const free = all
    .filter((id) => layout.free[id])
    .sort((a, b) => {
      const pa = layout.free[a]!;
      const pb = layout.free[b]!;
      // Topo antes da base; dentro de cada grupo, pela distância à borda.
      if (pa.v !== pb.v) return pa.v === "top" ? -1 : 1;
      return pa.v === "top" ? pa.y - pb.y : pb.y - pa.y;
    });
  return [...layout.left, ...layout.right, ...free];
}
