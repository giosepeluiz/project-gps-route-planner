import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServices } from "@/lib/server/services";

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/**
 * GET /api/reverse?lat=…&lng=…[&kind=area]
 * Responde { label, provider } com o endereço do ponto (ou, com kind=area, o
 * nome da zona: bairro/freguesia e cidade), ou { label: null }.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = Query.safeParse({ lat: params.get("lat") ?? "", lng: params.get("lng") ?? "" });
  if (!parsed.success || params.get("lat") === "" || params.get("lng") === "") {
    return NextResponse.json({ error: "Coordenadas inválidas." }, { status: 400 });
  }

  const { geocoder } = getServices();
  const found = params.get("kind") === "area" ? await geocoder.area(parsed.data) : await geocoder.reverse(parsed.data);
  return NextResponse.json(found ?? { label: null, provider: null }, {
    headers: { "Cache-Control": "private, max-age=86400" },
  });
}
