/** Estilo principal: tiles vetoriais do OpenFreeMap, sem chave de API. */
export const PRIMARY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * Atribuição fixa, sempre visível no mapa. O crédito do OpenFreeMap vem do
 * próprio estilo e aparece ao lado desta.
 */
export const MAP_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';

/**
 * Estilo reserva, lido no servidor. Aceita uma URL completa em
 * MAP_FALLBACK_STYLE_URL ou monta a do MapTiler a partir de MAPTILER_KEY.
 *
 * Atenção: a URL do estilo é baixada pelo navegador, então esta chave é
 * pública por natureza. Restrinja-a por domínio no painel do MapTiler.
 */
export function getFallbackStyleUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = env.MAP_FALLBACK_STYLE_URL?.trim();
  if (explicit) return explicit;
  const key = env.MAPTILER_KEY?.trim();
  if (key) {
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`;
  }
  return null;
}
