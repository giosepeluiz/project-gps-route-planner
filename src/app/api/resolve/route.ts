import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/server/services";

const Query = z.object({ u: z.string().trim().min(1).max(2048) });

/**
 * GET /api/resolve?u=<coordenadas ou URL de mapa>
 * Responde { lat, lng, label? } ou 422 quando não encontra coordenadas.
 * Só acessa serviços de mapas conhecidos (ver src/lib/server/resolve.ts).
 */
export async function GET(request: NextRequest) {
  const parsed = Query.safeParse({ u: request.nextUrl.searchParams.get("u") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe uma URL ou coordenada." }, { status: 400 });
  }

  const place = await getServices().resolveInput(parsed.data.u);
  if (!place) {
    return NextResponse.json(
      { error: "Não foi possível encontrar coordenadas nesse link." },
      { status: 422 },
    );
  }
  return NextResponse.json(place, { headers: { "Cache-Control": "private, max-age=86400" } });
}
