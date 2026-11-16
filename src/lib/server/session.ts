/**
 * Acesso por senha simples: APP_PASSWORD + cookie httpOnly assinado (HMAC-SHA256).
 * Usa só Web Crypto, para rodar tanto no proxy quanto nas rotas.
 */

export const SESSION_COOKIE = "rotas_sessao";
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;

export type AuthMode =
  /** Sem senha configurada, em desenvolvimento: site aberto. */
  | { mode: "open" }
  /** Sem senha configurada, em produção: tudo bloqueado, para ninguém gastar as cotas. */
  | { mode: "locked" }
  | { mode: "password"; password: string; secret: string };

export function authConfig(env: Record<string, string | undefined> = process.env): AuthMode {
  const password = env.APP_PASSWORD?.trim();
  if (!password) return env.NODE_ENV === "production" ? { mode: "locked" } : { mode: "open" };
  // Sem SESSION_SECRET, a chave de assinatura deriva da senha: trocar a senha encerra as sessões.
  const secret = env.SESSION_SECRET?.trim() || `rotas:${password}`;
  return { mode: "password", password, secret };
}

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Comparação em tempo constante (não vaza onde as strings diferem). */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Token da sessão: "<expira em ms>.<assinatura>". */
export async function signSession(secret: string, expiresAt: number): Promise<string> {
  return `${expiresAt}.${await hmac(secret, `sessao:${expiresAt}`)}`;
}

export async function verifySession(
  secret: string,
  token: string | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const [expires, signature, ...rest] = token.split(".");
  const expiresAt = Number(expires);
  if (rest.length > 0 || !signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  return sameString(signature, await hmac(secret, `sessao:${expiresAt}`));
}

/** Compara a senha digitada com a configurada, em tempo constante. */
export async function checkPassword(input: string, expected: string): Promise<boolean> {
  // Assinar as duas com a mesma chave iguala os tamanhos antes de comparar.
  const [a, b] = await Promise.all([hmac("senha", input), hmac("senha", expected)]);
  return sameString(a, b);
}
