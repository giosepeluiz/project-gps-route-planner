import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reviewRoute } from "@/lib/server/ai";
import { getServices } from "@/lib/server/services";
import { MAX_STOPS } from "@/lib/stops";

const Body = z
  .object({
    /** Só os rótulos, na ordem da visita. Nada de coordenadas ou outros dados. */
    labels: z.array(z.string().trim().min(1).max(120)).min(3).max(MAX_STOPS + 2),
    legMinutes: z.array(z.number().int().min(0).max(100_000)).max(MAX_STOPS + 1),
    roundTrip: z.boolean(),
    lockedCount: z.number().int().min(0).max(MAX_STOPS),
  })
  .refine((body) => body.legMinutes.length === body.labels.length - 1);

/**
 * POST /api/ai/review
 * Comentário da IA sobre a ordem final. Nunca bloqueia: sem IA, responde
 * { tier: "local" } e a interface segue só com o algoritmo.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados da rota inválidos." }, { status: 400 });
  }

  const { ai, cache } = getServices();
  const key = `ai:review:v1:${createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex")}`;
  const headers = { "Cache-Control": "no-store" };

  const cached = await cache.get<object>(key);
  if (cached) return NextResponse.json(cached, { headers });

  const result = await reviewRoute(ai, parsed.data);
  if (!result) {
    // Falha não vai para o cache: a IA pode voltar logo depois.
    return NextResponse.json({ tier: "local", provider: null, review: null }, { headers });
  }
  const payload = { tier: result.tier, provider: result.provider, review: result.data };
  await cache.set(key, payload, 24 * 3600);
  return NextResponse.json(payload, { headers });
}
