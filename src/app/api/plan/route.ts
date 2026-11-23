import { NextResponse, type NextRequest } from "next/server";
import { readJsonLimited } from "@/lib/server/read-json";
import { z } from "zod";
import { NoRouteError } from "@/lib/server/matrix";
import { planRoute, type PlanPoint } from "@/lib/server/plan";
import { getServices } from "@/lib/server/services";
import { MAX_STOPS } from "@/lib/stops";
import { MAX_DWELL_MINUTES } from "@/lib/types";

const Point = z.object({
  id: z.string().min(1).max(64),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Permanência na parada (minutos). */
  dwellMin: z.number().int().min(0).max(MAX_DWELL_MINUTES).optional(),
});

const Body = z.object({
  start: Point,
  stops: z.array(Point).max(MAX_STOPS),
  end: Point.nullable(),
  roundTrip: z.boolean(),
  locks: z.record(z.string().max(64), z.number().int().min(0).max(MAX_STOPS)).optional(),
  mode: z.enum(["depart", "arrive"]),
  /** ISO 8601, ou null para "agora". */
  at: z.iso.datetime({ offset: true }).nullable(),
  /** Direção do carro no início, em graus (só na viagem). */
  heading: z.number().min(0).max(360).optional(),
  /** Chegada obrigatória numa parada, com a saída fixa. */
  deadline: z.object({ stopId: z.string().min(1).max(64), at: z.iso.datetime({ offset: true }) }).optional(),
});

/**
 * POST /api/plan
 * Recebe os locais (só id e coordenadas) e devolve a melhor ordem, os tempos
 * de cada trecho, a fonte dos dados e a geometria da rota.
 */
export async function POST(request: NextRequest) {
  // Corpo limitado: um pedido gigante é recusado antes de ser lido inteiro.
  const body = await readJsonLimited(request, 32000);
  if (!body.ok) return NextResponse.json({ error: "Corpo inválido." }, { status: body.status });
  const json = body.value;
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados da rota inválidos." }, { status: 400 });
  }

  const { matrix, geometry } = getServices();
  try {
    const plan = await planRoute(
      {
        ...parsed.data,
        at: parsed.data.at ? new Date(parsed.data.at) : null,
        deadline: parsed.data.deadline ? { stopId: parsed.data.deadline.stopId, at: new Date(parsed.data.deadline.at) } : undefined,
      },
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
