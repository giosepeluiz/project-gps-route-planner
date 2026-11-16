import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "@/app/api/login/route";
import { proxy } from "@/proxy";
import { apiLimitPerMinute, createRateLimiter } from "./server/rate-limit";
import {
  authConfig,
  checkPassword,
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "./server/session";

const SECRET = "segredo-de-teste";
const TEST_PASSWORD = "senha-de-teste";

afterEach(() => vi.unstubAllEnvs());

describe("sessão assinada", () => {
  it("aceita o token válido e rejeita adulterado, vencido ou malformado", async () => {
    const now = 1_000_000;
    const token = await signSession(SECRET, now + 60_000);
    expect(await verifySession(SECRET, token, now)).toBe(true);
    // Vencido.
    expect(await verifySession(SECRET, token, now + 60_001)).toBe(false);
    // Validade esticada sem refazer a assinatura.
    const [, signature] = token.split(".");
    expect(await verifySession(SECRET, `${now + 999_999}.${signature}`, now)).toBe(false);
    // Assinado com outra chave.
    expect(await verifySession("outra-chave", token, now)).toBe(false);
    for (const bad of [undefined, "", "abc", "123", `${now + 60_000}.`, `${token}.extra`]) {
      expect(await verifySession(SECRET, bad, now)).toBe(false);
    }
  });

  it("confere a senha", async () => {
    expect(await checkPassword(TEST_PASSWORD, TEST_PASSWORD)).toBe(true);
    expect(await checkPassword("errada", TEST_PASSWORD)).toBe(false);
    expect(await checkPassword("", TEST_PASSWORD)).toBe(false);
  });

  it("modo de acesso: aberto em dev sem senha, bloqueado em produção sem senha", () => {
    expect(authConfig({ NODE_ENV: "development" })).toEqual({ mode: "open" });
    expect(authConfig({ NODE_ENV: "production" })).toEqual({ mode: "locked" });
    expect(authConfig({ NODE_ENV: "production", APP_PASSWORD: "  " })).toEqual({ mode: "locked" });
    expect(authConfig({ APP_PASSWORD: "x", SESSION_SECRET: "s" })).toEqual({
      mode: "password",
      password: "x",
      secret: "s",
    });
    // Sem SESSION_SECRET, a chave deriva da senha.
    expect(authConfig({ APP_PASSWORD: "x" })).toMatchObject({ mode: "password", secret: "rotas:x" });
  });
});

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

const request = (path: string, init: { cookie?: string; ip?: string } = {}) =>
  new NextRequest(`https://rotas.exemplo${path}`, {
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      "x-forwarded-for": init.ip ?? "9.9.9.9",
    },
  });

describe("proxy: senha no site e nas rotas /api", () => {
  it("sem senha em desenvolvimento, o site fica aberto", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_PASSWORD", "");
    expect((await proxy(request("/", { ip: "10.0.0.1" }))).headers.get("x-middleware-next")).toBe("1");
  });

  it("sem senha em produção, tudo responde 503", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSWORD", "");
    expect((await proxy(request("/", { ip: "10.0.0.2" }))).status).toBe(503);
    expect((await proxy(request("/api/plan", { ip: "10.0.0.2" }))).status).toBe(503);
  });

  it("com senha: sem cookie, a página vai para /login e a API responde 401", async () => {
    vi.stubEnv("APP_PASSWORD", TEST_PASSWORD);
    vi.stubEnv("SESSION_SECRET", SECRET);
    const page = await proxy(request("/", { ip: "10.0.0.3" }));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("https://rotas.exemplo/login");
    expect((await proxy(request("/api/plan", { ip: "10.0.0.3" }))).status).toBe(401);
    // A tela e a rota de login ficam acessíveis.
    expect((await proxy(request("/login", { ip: "10.0.0.3" }))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request("/api/login", { ip: "10.0.0.3" }))).headers.get("x-middleware-next")).toBe("1");
  });

  it("com cookie válido passa; com cookie falso não", async () => {
    vi.stubEnv("APP_PASSWORD", TEST_PASSWORD);
    vi.stubEnv("SESSION_SECRET", SECRET);
    const token = await signSession(SECRET, Date.now() + 60_000);
    const ok = await proxy(request("/api/plan", { cookie: `${SESSION_COOKIE}=${token}`, ip: "10.0.0.4" }));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    const forged = await signSession("chave-errada", Date.now() + 60_000);
    const bad = await proxy(request("/api/plan", { cookie: `${SESSION_COOKIE}=${forged}`, ip: "10.0.0.4" }));
    expect(bad.status).toBe(401);
  });

  it("limita as tentativas de login por IP (10 por minuto)", async () => {
    vi.stubEnv("APP_PASSWORD", TEST_PASSWORD);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await proxy(request("/api/login", { ip: "10.0.0.5" }))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Outro IP não é afetado.
    expect((await proxy(request("/api/login", { ip: "10.0.0.6" }))).status).toBe(200);
  });
});

describe("POST /api/login", () => {
  const login = (password: unknown) =>
    POST(
      new NextRequest("https://rotas.exemplo/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
    );

  it("senha certa grava o cookie httpOnly; senha errada responde 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSWORD", TEST_PASSWORD);
    vi.stubEnv("SESSION_SECRET", SECRET);

    const wrong = await login("errada");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect((await login(123)).status).toBe(401);

    const ok = await login(TEST_PASSWORD);
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    // O cookie emitido é aceito pelo proxy.
    const token = cookie.split(";")[0].split("=")[1];
    expect(await verifySession(SECRET, decodeURIComponent(token))).toBe(true);
  });

  it("sair apaga o cookie", async () => {
    const out = await DELETE();
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});
