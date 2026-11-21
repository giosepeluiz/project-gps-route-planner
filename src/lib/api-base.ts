/**
 * Endereço da API. No site, as rotas /api ficam no mesmo endereço (base vazia).
 * Nos apps (Windows, Linux e Android), a interface vem empacotada no próprio
 * app e a API continua no servidor: a base vem de NEXT_PUBLIC_API_BASE no
 * build dos apps (ex.: https://rotas.arqueirover.de). As chaves das APIs
 * externas ficam sempre no servidor.
 */
const BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

/** Caminho da API ("/api/...") com a base certa para o site ou para os apps. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}
