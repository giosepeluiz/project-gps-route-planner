/**
 * Cache do servidor. Duas implementações: memória (LRU) e Upstash Redis (REST).
 * Sem as variáveis do Upstash, vale só a memória da instância.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    // Reinsere para marcar como usado recentemente (LRU).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

type FetchFn = typeof fetch;

/** Upstash Redis pela API REST (um comando por requisição, como array JSON). */
export class UpstashCache implements Cache {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async command(args: (string | number)[]): Promise<unknown> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash respondeu ${res.status}`);
    return ((await res.json()) as { result?: unknown }).result;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.command(["GET", key]);
    return typeof raw === "string" ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.command(["SET", key, JSON.stringify(value), "EX", Math.max(1, Math.round(ttlSeconds))]);
  }
}

/** Usa o cache remoto, mas nunca deixa uma falha dele derrubar a requisição. */
export class LayeredCache implements Cache {
  constructor(
    private readonly local: Cache,
    private readonly remote: Cache,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const hit = await this.local.get<T>(key);
    if (hit !== null) return hit;
    try {
      const remote = await this.remote.get<T>(key);
      if (remote !== null) await this.local.set(key, remote, 3600);
      return remote;
    } catch (err) {
      console.warn("Cache remoto indisponível (leitura):", err);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.local.set(key, value, ttlSeconds);
    try {
      await this.remote.set(key, value, ttlSeconds);
    } catch (err) {
      console.warn("Cache remoto indisponível (escrita):", err);
    }
  }
}

export function createCache(env: Record<string, string | undefined> = process.env): Cache {
  const memory = new MemoryCache();
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? new LayeredCache(memory, new UpstashCache(url, token)) : memory;
}
