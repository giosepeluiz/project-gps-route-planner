/**
 * Regras comuns das cadeias de provedores: timeout por tentativa, 1 retry e
 * circuit breaker simples (pula o provedor por 60 s após 3 falhas seguidas).
 */
export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Provedor "${name}" em pausa após falhas seguidas.`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Resposta definitiva do provedor (ex.: "não existe caminho"). Não é falha:
 * não tem retry, não abre o circuito e não passa para o próximo provedor.
 */
export class DefinitiveError extends Error {}

export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    readonly name: string,
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get isOpen(): boolean {
    return this.now() < this.openUntil;
  }

  success(): void {
    this.failures = 0;
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = this.now() + this.cooldownMs;
      this.failures = 0;
    }
  }
}

export interface PolicyOptions {
  timeoutMs?: number;
  retries?: number;
}

/**
 * Executa `fn` com timeout e retry. Uma chamada inteira (com os retries) conta
 * como uma falha só para o circuit breaker.
 */
export async function withPolicy<T>(
  breaker: CircuitBreaker,
  fn: (signal: AbortSignal) => Promise<T>,
  { timeoutMs = 8000, retries = 1 }: PolicyOptions = {},
): Promise<T> {
  if (breaker.isOpen) throw new CircuitOpenError(breaker.name);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn(AbortSignal.timeout(timeoutMs));
      breaker.success();
      return result;
    } catch (err) {
      if (err instanceof DefinitiveError) {
        breaker.success();
        throw err;
      }
      lastError = err;
    }
  }
  breaker.failure();
  throw lastError;
}

/**
 * Fila global: garante um intervalo mínimo entre o início das chamadas
 * (o Nominatim público aceita no máximo 1 requisição por segundo).
 */
export class RateQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastStart = 0;

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const start = this.tail.then(async () => {
      const wait = this.lastStart + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
    });
    // A próxima chamada espera só o INÍCIO desta, não o fim.
    this.tail = start.catch(() => {});
    return start.then(fn);
  }
}
