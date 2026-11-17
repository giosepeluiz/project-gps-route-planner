/**
 * Limite de requisições por IP, em janela fixa.
 * Fica na memória de cada instância do servidor: na Vercel, instâncias
 * diferentes contam separado, então é uma proteção simples, não uma garantia.
 */
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Segundos até a janela reiniciar. */
  retryAfterS: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

interface Window {
  count: number;
  resetAt: number;
}

export function createRateLimiter({
  limit,
  windowMs = 60_000,
  now = Date.now,
  maxKeys = 5000,
}: {
  limit: number;
  windowMs?: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const windows = new Map<string, Window>();

  return {
    check(key) {
      const time = now();
      let current = windows.get(key);
      if (!current || current.resetAt <= time) {
        // Antes de crescer demais, descarta as janelas já vencidas.
        if (windows.size >= maxKeys) {
          for (const [k, w] of windows) if (w.resetAt <= time) windows.delete(k);
          if (windows.size >= maxKeys) windows.clear();
        }
        current = { count: 0, resetAt: time + windowMs };
        windows.set(key, current);
      }
      current.count += 1;
      return {
        ok: current.count <= limit,
        remaining: Math.max(0, limit - current.count),
        retryAfterS: Math.max(1, Math.ceil((current.resetAt - time) / 1000)),
      };
    },
  };
}

/** Limite geral das rotas /api, por minuto (RATE_LIMIT_PER_MIN, padrão 60). */
export function apiLimitPerMinute(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.RATE_LIMIT_PER_MIN);
  return Number.isInteger(value) && value > 0 ? value : 60;
}

