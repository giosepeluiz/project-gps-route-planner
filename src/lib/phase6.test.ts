import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { apiLimitPerMinute, createRateLimiter } from "./server/rate-limit";

describe("limite de requisições por IP", () => {
  it("bloqueia depois do limite e libera na janela seguinte", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    expect(limiter.check("1.1.1.1")).toMatchObject({ ok: true, remaining: 2 });
    limiter.check("1.1.1.1");
    expect(limiter.check("1.1.1.1")).toMatchObject({ ok: true, remaining: 0 });
    const blocked = limiter.check("1.1.1.1");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterS).toBe(60);
    // Outro IP tem a própria contagem.
    expect(limiter.check("2.2.2.2").ok).toBe(true);
    now = 60_001;
    expect(limiter.check("1.1.1.1").ok).toBe(true);
  });

  it("não cresce sem limite", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now, maxKeys: 10 });
    for (let i = 0; i < 50; i++) {
      now += 2000;
      expect(limiter.check(`ip-${i}`).ok).toBe(true);
    }
  });

  it("limite configurável, com padrão de 60 por minuto", () => {
    expect(apiLimitPerMinute({})).toBe(60);
    expect(apiLimitPerMinute({ RATE_LIMIT_PER_MIN: "30" })).toBe(30);
    expect(apiLimitPerMinute({ RATE_LIMIT_PER_MIN: "abc" })).toBe(60);
    expect(apiLimitPerMinute({ RATE_LIMIT_PER_MIN: "-5" })).toBe(60);
  });
});

describe("proxy nas rotas /api", () => {
  const request = (ip: string) =>
    new NextRequest("https://rotas.exemplo/api/plan", { headers: { "x-forwarded-for": ip } });

  it("deixa passar até o limite e responde 429 depois, por IP", () => {
    const limit = apiLimitPerMinute();
    for (let i = 0; i < limit; i++) {
      expect(proxy(request("10.0.0.1")).headers.get("x-middleware-next")).toBe("1");
    }
    const blocked = proxy(request("10.0.0.1"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(proxy(request("10.0.0.2")).headers.get("x-middleware-next")).toBe("1");
  });

  it("só atua nas rotas /api (o site não passa pelo proxy)", async () => {
    const { config } = await import("@/proxy");
    expect(config.matcher).toEqual(["/api/:path*"]);
  });
});
