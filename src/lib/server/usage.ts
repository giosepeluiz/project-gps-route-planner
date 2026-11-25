/**
 * Trava de cota: conta, por mês, quanto de cada serviço externo já foi usado e
 * recusa a chamada ANTES de passar do limite. Os limites padrão ficam 10% abaixo
 * da cota gratuita de cada serviço, para nunca cair em cobrança.
 *
 * O contador fica no cache compartilhado (Upstash, quando configurado), então
 * vale para todas as instâncias do servidor. A leitura e a escrita não são
 * atômicas; a folga de 10% cobre o pior caso de chamadas simultâneas.
 */
import type { Cache } from "./cache";
import { QuotaError } from "./resilience";

export type BudgetKey = "tomtom" | "tomtom-rota" | "here" | "google" | "google-rota";

/**
 * Padrões (90% da cota gratuita mensal):
 * - tomtom: Matrix Routing, 2.500 (contado por pedido);
 * - tomtom-rota: Routing API (Calculate Route), 20.000;
 * - here: Matrix Routing, 2.500 transações (contado por célula, o pior caso, até confirmar a unidade);
 * - google: Compute Route Matrix Pro, 5.000 elementos;
 * - google-rota: Compute Routes Pro, 5.000 pedidos.
 */
export const BUDGET_DEFAULTS: Record<BudgetKey, number> = {
  tomtom: 2250,
  "tomtom-rota": 18000,
  here: 2250,
  google: 4500,
  "google-rota": 4500,
};

const ENV_NAMES: Record<BudgetKey, string> = {
  tomtom: "QUOTA_TOMTOM",
  "tomtom-rota": "QUOTA_TOMTOM_ROTA",
  here: "QUOTA_HERE",
  google: "QUOTA_GOOGLE",
  "google-rota": "QUOTA_GOOGLE_ROTA",
};

/** Limites mensais: os padrões, ou o valor da variável de ambiente (0 desliga o serviço). */
export function budgetLimits(env: Record<string, string | undefined> = process.env): Record<BudgetKey, number> {
  const limits = { ...BUDGET_DEFAULTS };
  for (const key of Object.keys(limits) as BudgetKey[]) {
    const raw = env[ENV_NAMES[key]]?.trim();
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0) limits[key] = value;
  }
  return limits;
}

export interface Budget {
  /** Reserva `units` do serviço neste mês; lança QuotaError se passaria do limite. */
  take(key: BudgetKey, units: number): Promise<void>;
  /** Quanto já foi usado, e o limite, de cada serviço neste mês. */
  usage(): Promise<Record<BudgetKey, { used: number; limit: number }>>;
}

const TTL_S = 45 * 24 * 3600;

export function createBudget({
  cache,
  limits = BUDGET_DEFAULTS,
  now = Date.now,
}: {
  cache: Cache;
  limits?: Record<BudgetKey, number>;
  now?: () => number;
}): Budget {
  const month = () => new Date(now()).toISOString().slice(0, 7);
  const cacheKey = (key: BudgetKey) => `usage:${month()}:${key}`;
  // Espelho em memória: cobre falhas do cache e chamadas seguidas no mesmo processo.
  const memory = new Map<string, number>();

  const read = async (key: BudgetKey) => {
    const k = cacheKey(key);
    const stored = await cache.get<number>(k).catch(() => null);
    return Math.max(typeof stored === "number" ? stored : 0, memory.get(k) ?? 0);
  };

  return {
    async take(key, units) {
      if (units <= 0) return;
      const used = await read(key);
      if (used + units > limits[key]) throw new QuotaError(key, 0, 300);
      const k = cacheKey(key);
      memory.set(k, used + units);
      await cache.set(k, used + units, TTL_S).catch(() => undefined);
    },
    async usage() {
      const keys = Object.keys(limits) as BudgetKey[];
      const used = await Promise.all(keys.map((key) => read(key)));
      return Object.fromEntries(keys.map((key, i) => [key, { used: used[i], limit: limits[key] }])) as Record<
        BudgetKey,
        { used: number; limit: number }
      >;
    },
  };
}
