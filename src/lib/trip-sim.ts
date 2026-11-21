/**
 * Viagem de teste (só no acesso local): um carro de mentira anda pela linha da
 * rota a velocidade constante e gera leituras de GPS como as de verdade, para
 * testar o modo viagem inteiro sem sair de casa.
 */
import { haversineMeters } from "./geo";
import { bearingDeg, type LngLat } from "./route-progress";

/** Velocidade padrão do carro de teste e as opções para escolher (km/h). */
export const SIM_SPEED_KMH = 150;
export const SIM_SPEEDS_KMH = [30, 50, 70, 90, 120, 150, 200, 300] as const;
/** Uma leitura por segundo, como o GPS do celular. */
export const SIM_INTERVAL_MS = 1000;

/** Ponto a `meters` do começo da linha, com a direção do trecho; no fim, para no último ponto. */
export function pointAlong(
  path: readonly LngLat[],
  meters: number,
): { lng: number; lat: number; heading: number | null; atEnd: boolean } {
  if (path.length === 0) return { lng: 0, lat: 0, heading: null, atEnd: true };
  let left = Math.max(0, meters);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const d = haversineMeters({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] });
    if (d > 0 && left <= d) {
      const k = left / d;
      return { lng: a[0] + (b[0] - a[0]) * k, lat: a[1] + (b[1] - a[1]) * k, heading: bearingDeg(a, b), atEnd: false };
    }
    left -= d;
  }
  const last = path[path.length - 1];
  const before = path.length > 1 ? path[path.length - 2] : null;
  return { lng: last[0], lat: last[1], heading: before ? bearingDeg(before, last) : null, atEnd: true };
}

/** Acesso local: localhost, 127.0.0.1, [::1], *.localhost ou um IP da rede de casa (192.168.x, 10.x, 172.16–31.x). */
export function isLocalHost(hostname: string): boolean {
  return (
    /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(hostname) ||
    hostname.endsWith(".localhost") ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}
