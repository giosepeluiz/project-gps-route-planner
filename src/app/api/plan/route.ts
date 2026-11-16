import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NoRouteError } from "@/lib/server/matrix";
import { planRoute, type PlanPoint } from "@/lib/server/plan";
import { getServices } from "@/lib/server/services";
import { MAX_STOPS } from "@/lib/stops";

const Point = z.object({
  id: z.string().min(1).max(64),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const Body = z.object({
  start: Point,
  stops: z.array(Point).max(MAX_STOPS),
  end: Point.nullable(),
  roundTrip: z.boolean(),
  lockOrder: z.boolean().optional(),
  mode: z.enum(["depart", "arrive"]),
  /** ISO 8601, ou null para "agora". */
  at: z.iso.datetime({ offset: true }).nullable(),
});

/**
 * POST /api/plan
 * Recebe os locais (só id e coordenadas) e devolve a melhor ordem, os tempos
 * de cada trecho, a fonte dos dados e a geometria da rota.
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

  const { matrix, geometry } = getServices();
  try {
    const plan = await planRoute(
      { ...parsed.data, at: parsed.data.at ? new Date(parsed.data.at) : null },
      { matrix, geometry },
    );
    return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof NoRouteError) {
      // 422: os locais são válidos, mas não há caminho de carro entre eles.
      return NextResponse.json(
        {
          error: "no_route",
          fromId: (err.from as PlanPoint | undefined)?.id ?? null,
          toId: (err.to as PlanPoint | undefined)?.id ?? null,
        },
        { status: 422 },
      );
    }
    console.error("Falha ao planejar a rota:", err);
    return NextResponse.json({ error: "Não foi possível calcular a rota." }, { status: 502 });
  }
}
