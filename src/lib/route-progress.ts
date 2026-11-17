/**
 * Onde o carro está sobre a linha da rota: projeção no trecho mais próximo,
 * quanto falta, direção da via e o pedaço da linha que ainda falta percorrer.
 * Funções puras, em [lng, lat] como no mapa.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export type LngLat = [number, number];

export interface Projection {
  /** Ponto mais próximo sobre a linha. */
  point: LngLat;
  /** Índice do segmento (entre line[index] e line[index + 1]). */
  index: number;
  /** Distância do ponto até a linha, em metros. */
  distanceM: number;
  /** Metros percorridos desde o começo da linha até o ponto projetado. */
  alongM: number;
  /** Comprimento total da linha, em metros. */
  lengthM: number;
  /** Direção da via no ponto projetado (graus a partir do norte, sentido horário). */
  bearing: number;
}

/** Distância entre dois pontos [lng, lat], em metros (haversine). */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Direção de a para b, em graus de 0 a 360 (0 = norte, 90 = leste). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * RAD;
  const φ2 = b[1] * RAD;
  const Δλ = (b[0] - a[0]) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Menor diferença entre dois ângulos, com sinal (de -180 a 180). */
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Interpola dois ângulos pelo caminho mais curto. */
export function lerpAngle(from: number, to: number, t: number): number {
  return (from + angleDelta(from, to) * t + 360) % 360;
}

/**
 * Projeta o ponto na linha. Usa uma projeção plana local (precisa para as
 * distâncias de uma via), o que é bem mais leve que geodésia a cada quadro.
 */
export function projectOnLine(point: LngLat, line: readonly LngLat[]): Projection | null {
  if (line.length < 2) return null;
  const cosLat = Math.cos(point[1] * RAD);
  const toXY = (p: LngLat): [number, number] => [
    (p[0] - point[0]) * RAD * EARTH_RADIUS_M * cosLat,
    (p[1] - point[1]) * RAD * EARTH_RADIUS_M,
  ];

  let best: { index: number; t: number; dist2: number } | null = null;
  const segmentLengths: number[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = toXY(line[i]);
    const [bx, by] = toXY(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    segmentLengths.push(Math.sqrt(len2));
    // O ponto está na origem: projeção de (0,0) sobre o segmento a→b.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const dist2 = px * px + py * py;
    if (!best || dist2 < best.dist2) best = { index: i, t, dist2 };
  }
  if (!best) return null;

  const a = line[best.index];
  const b = line[best.index + 1];
  const projected: LngLat = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t];
  const before = segmentLengths.slice(0, best.index).reduce((sum, l) => sum + l, 0);
  return {
    point: projected,
    index: best.index,
    distanceM: Math.sqrt(best.dist2),
    alongM: before + segmentLengths[best.index] * best.t,
    lengthM: segmentLengths.reduce((sum, l) => sum + l, 0),
    // Segmento sem comprimento (pontos repetidos) não tem direção: usa o próximo que tiver.
    bearing: segmentBearing(line, best.index),
  };
}

function segmentBearing(line: readonly LngLat[], index: number): number {
  for (let i = index; i < line.length - 1; i++) {
    if (line[i][0] !== line[i + 1][0] || line[i][1] !== line[i + 1][1]) return bearingDeg(line[i], line[i + 1]);
  }
  for (let i = index; i > 0; i--) {
    if (line[i][0] !== line[i - 1][0] || line[i][1] !== line[i - 1][1]) return bearingDeg(line[i - 1], line[i]);
  }
  return 0;
}

/** O que ainda falta da linha, começando no ponto projetado. */
export function remainingLine(line: readonly LngLat[], projection: Projection): LngLat[] {
  return [projection.point, ...line.slice(projection.index + 1)];
}

/**
 * Fração do trecho que ainda falta (0 a 1), pelo comprimento da linha. Serve
 * para descontar o tempo e a distância do trecho conforme o carro avança.
 */
export function remainingFraction(projection: Projection): number {
  if (projection.lengthM <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - projection.alongM / projection.lengthM));
}
