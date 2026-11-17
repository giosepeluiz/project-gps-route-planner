import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/server/services";

const Query = z.object({
  q: z.string().trim().min(3).max(120),
  near: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const [lat, lng] = value.split(",").map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        ctx.addIssue({ code: "custom", message: "near inválido" });
        return z.NEVER;
      }
      return { lat, lng };
    }),
});

/**
 * GET /api/suggest?q=…&near=lat,lng
 * Sugestões de endereço para o autocompletar: { suggestions: [{ label, detail, lat, lng }] }.
 * Sem chave da TomTom, a lista vem vazia (o campo continua funcionando com Enter).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = Query.safeParse({ q: params.get("q") ?? "", near: params.get("near") ?? undefined });
  if (!parsed.success) return NextResponse.json({ suggestions: [] }, { status: 400 });

  const suggestions = await getServices().suggest.suggest(parsed.data.q, parsed.data.near);
  return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
