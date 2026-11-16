import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  authConfig,
  checkPassword,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  signSession,
} from "@/lib/server/session";

const Body = z.object({ password: z.string().min(1).max(200) });

/** POST /api/login { password } — confere a senha e grava o cookie de sessão. */
export async function POST(request: NextRequest) {
  const auth = authConfig();
  if (auth.mode === "open") return NextResponse.json({ ok: true });
  if (auth.mode === "locked") {
    return NextResponse.json({ error: "Defina APP_PASSWORD nas variáveis de ambiente." }, { status: 503 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = null;
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success || !(await checkPassword(parsed.data.password, auth.password))) {
    return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await signSession(auth.secret, Date.now() + SESSION_MAX_AGE_S * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return response;
}

/** DELETE /api/login — encerra a sessão. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}
