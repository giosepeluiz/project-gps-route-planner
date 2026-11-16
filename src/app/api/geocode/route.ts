import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/server/services";

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

const Query = z.object({
  q: z.string().trim().min(2).max(300),
  /** Área visível do mapa: "oeste,sul,leste,norte". */
  bbox: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const parts = value.split(",");
      const box = z.tuple([lng, lat, lng, lat]).safeParse(parts);
      if (!box.success) {
        ctx.addIssue({ code: "custom", message: "bbox inválido" });
        return z.NEVER;
      }
      const [west, south, east, north] = box.data;
      return { west, south, east, north };
    }),
});

/**
 * GET /api/geocode?q=<endereço>&bbox=<oeste,sul,leste,norte>
 * Responde { lat, lng, label, confidence, provider } ou 422 quando não encontra.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = Query.safeParse({ q: params.get("q") ?? "", bbox: params.get("bbox") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe um endereço para buscar." }, { status: 400 });
  }

  const found = await getServices().geocoder.search(parsed.data.q, parsed.data.bbox);
  if (!found) {
    return NextResponse.json({ error: "Local não encontrado." }, { status: 422 });
  }
  return NextResponse.json(found, { headers: { "Cache-Control": "private, max-age=86400" } });
}
