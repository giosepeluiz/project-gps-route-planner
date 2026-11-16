/**
 * Locais travados: id da parada → posição na visita (0 = primeira parada).
 * Um local travado fica na posição dele; os demais são otimizados em volta.
 */
export type Locks = Readonly<Record<string, number>>;

/** Remove travas de paradas que não existem mais, fora da faixa ou em posição repetida. */
export function cleanLocks(stopIds: readonly string[], locks: Locks): Record<string, number> {
  const result: Record<string, number> = {};
  const taken = new Set<number>();
  for (const id of stopIds) {
    const position = locks[id];
    if (
      position === undefined ||
      !Number.isInteger(position) ||
      position < 0 ||
      position >= stopIds.length ||
      taken.has(position)
    ) {
      continue;
    }
    taken.add(position);
    result[id] = position;
  }
  return result;
}

/**
 * Arrastar e soltar: move a parada de `from` para `to` na ordem exibida.
 * A parada arrastada fica travada onde foi solta, e as que já estavam
 * travadas acompanham o deslocamento (continuam onde aparecem na lista).
 */
export function moveStop(
  displayedIds: readonly string[],
  locks: Locks,
  from: number,
  to: number,
): { order: string[]; locks: Record<string, number> } {
  const order = [...displayedIds];
  if (from < 0 || from >= order.length || to < 0 || to >= order.length) {
    return { order, locks: { ...locks } };
  }
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);

  const next: Record<string, number> = {};
  order.forEach((id, index) => {
    if (id === moved || locks[id] !== undefined) next[id] = index;
  });
  return { order, locks: next };
}

/** Trava a parada na posição em que está aparecendo, ou destrava. */
export function toggleLock(
  displayedIds: readonly string[],
  locks: Locks,
  id: string,
): Record<string, number> {
  const next = { ...locks };
  if (next[id] !== undefined) {
    delete next[id];
    return next;
  }
  const index = displayedIds.indexOf(id);
  if (index >= 0) next[id] = index;
  return next;
}

/** Ao remover uma parada, as travadas depois dela sobem uma posição. */
export function removeFromLocks(
  displayedIds: readonly string[],
  locks: Locks,
  removedId: string,
): Record<string, number> {
  const removedIndex = displayedIds.indexOf(removedId);
  const next: Record<string, number> = {};
  for (const [id, position] of Object.entries(locks)) {
    if (id === removedId) continue;
    next[id] = removedIndex >= 0 && position > removedIndex ? position - 1 : position;
  }
  return next;
}
