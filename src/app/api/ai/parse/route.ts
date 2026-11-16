import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parsePlaces } from "@/lib/server/ai";
import { getServices } from "@/lib/server/services";

const Body = z.object({ text: z.string().trim().min(3).max(600) });

/**
 * POST /api/ai/parse
 * Interpreta texto livre ("farmácia perto do Colombo e depois Belém") em uma
 * lista de buscas. Sem IA, responde { tier: "local", places: [] }.
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
    return NextResponse.json({ error: "Informe um texto para interpretar." }, { status: 400 });
  }

  const result = await parsePlaces(getServices().ai, parsed.data.text);
  return NextResponse.json(
    result
      ? { tier: result.tier, provider: result.provider, places: result.data.places }
      : { tier: "local", provider: null, places: [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
