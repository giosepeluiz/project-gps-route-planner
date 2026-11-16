const EARTH_RADIUS_M = 6_371_008.8;

interface LatLng {
  lat: number;
  lng: number;
}

/** Distância em linha reta (haversine), em metros. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Último recurso da cadeia de provedores: tempo estimado por distância
 * (haversine × 1.4 ÷ 35 km/h). Sempre deve ser rotulado como estimativa.
 */
export function estimateSeconds(a: LatLng, b: LatLng): number {
  const roadMeters = haversineMeters(a, b) * 1.4;
  const metersPerSecond = 35_000 / 3600;
  return Math.round(roadMeters / metersPerSecond);
}

