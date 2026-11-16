const pad = (n: number) => String(n).padStart(2, "0");

/** "45 min", "2 h", "2 h 13 min". */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/** Hora local no formato "11:05". */
export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Hora local, com o dia quando ele difere da referência: "11:05" ou "00:40 (18/11)". */
export function formatTimeWithDay(date: Date, reference: Date): string {
  const sameDay =
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate();
  if (sameDay) return formatTime(date);
  return `${formatTime(date)} (${pad(date.getDate())}/${pad(date.getMonth() + 1)})`;
}

/** Distância com ponto decimal: "12.5 km". */
export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Coordenadas curtas para rótulos de pin: "38.7074, -9.1373". */
export function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** Valor para <input type="datetime-local">, no fuso do navegador. */
export function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function pluralStops(count: number): string {
  return count === 1 ? "1 parada" : `${count} paradas`;
}
