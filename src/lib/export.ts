/** Ações de saída: links para Google Maps e Waze e a rota em texto. */
import { formatDuration, formatTime } from "./format";
import type { Place, Plan } from "./types";

interface LatLng {
  lat: number;
  lng: number;
}

const coord = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Limite de paradas intermediárias por link do Google Maps: 9 em geral e 3 nos
 * navegadores de celular (documentação do Google Maps URLs).
 */
export const GOOGLE_WAYPOINTS_DESKTOP = 9;
export const GOOGLE_WAYPOINTS_MOBILE = 3;

/**
 * Links "Abrir no Google Maps" na ordem otimizada. Quando há mais paradas do
 * que o limite, a rota é dividida em vários links encadeados: o destino de um
 * é a origem do próximo.
 */
export function googleMapsLinks(sequence: readonly LatLng[], maxWaypoints = GOOGLE_WAYPOINTS_DESKTOP): string[] {
  if (sequence.length < 2) return [];
  const links: string[] = [];
  // Cada link cobre origem + até maxWaypoints paradas + destino.
  const step = maxWaypoints + 1;
  for (let from = 0; from < sequence.length - 1; from += step) {
    const to = Math.min(from + step, sequence.length - 1);
    const params = new URLSearchParams({
      api: "1",
      origin: coord(sequence[from]),
      destination: coord(sequence[to]),
      travelmode: "driving",
    });
    const waypoints = sequence.slice(from + 1, to).map(coord);
    // URLSearchParams codifica "|" como %7C e "," como %2C, como a documentação pede.
    if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
    links.push(`https://www.google.com/maps/dir/?${params}`);
  }
  return links;
}

/** O Waze aceita um destino por link. */
export function wazeLink(place: LatLng): string {
  return `https://waze.com/ul?ll=${coord(place)}&navigate=yes`;
}

/**
 * A rota em texto, para copiar ou compartilhar.
 * @param stopCount quantas paradas a rota tem; um trecho a mais é a chegada ao fim
 */
export function routeText(
  start: Place,
  plan: Plan,
  stopCount: number,
  roundTrip: boolean,
  links: readonly string[],
): string {
  const lines = [
    `Rota: ${formatDuration(plan.totalSeconds)} (saída ${formatTime(plan.departAt)}, chegada ${formatTime(plan.arriveAt)})`,
    `A. ${start.label} (saída ${formatTime(plan.departAt)})`,
  ];
  plan.legs.forEach((leg, i) => {
    const prefix = i < stopCount ? `${i + 1}.` : roundTrip ? "Volta:" : "B.";
    const stay = leg.dwellSeconds > 0 ? `, fica ${formatDuration(leg.dwellSeconds)}, sai ${formatTime(leg.leaveAt)}` : "";
    lines.push(`${prefix} ${leg.to.label} (chega ${formatTime(leg.arriveAt)}${stay})`);
  });
  if (links.length > 0) lines.push("");
  links.forEach((link, i) =>
    lines.push(
      links.length === 1 ? `Google Maps: ${link}` : `Google Maps (parte ${i + 1} de ${links.length}): ${link}`,
    ),
  );
  return lines.join("\n");
}
