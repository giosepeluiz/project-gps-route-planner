/**
 * Cores dos trechos da rota pelas ruas: uma por trecho, em ciclo.
 * Nenhuma é azul, que fica reservado para a linha pontilhada das retas.
 * Vizinhas na lista são bem diferentes entre si, para trechos seguidos não se confundirem.
 */
export const LEG_COLORS = [
  "#15803d", // verde
  "#ea580c", // laranja
  "#9333ea", // roxo
  "#dc2626", // vermelho
  "#a16207", // mostarda
  "#db2777", // rosa
  "#4d7c0f", // verde-oliva
  "#7c2d12", // marrom
] as const;

export const legColor = (index: number): string => LEG_COLORS[index % LEG_COLORS.length];
