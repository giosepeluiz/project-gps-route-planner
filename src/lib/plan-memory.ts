/**
 * Memória do último cálculo bom do servidor. Enquanto uma resposta nova não chega
 * (ou se ela falha), a tela não pode voltar para a estimativa em linha reta, que
 * dá tempos absurdos: ela segue com o que o servidor já calculou.
 */
import type { PlanResponse } from "./server/plan";
import { estimateLegTime } from "./plan";
import type { LegTimeFn } from "./types";

export interface RememberedPlan {
  /** Assinatura dos locais (início, paradas e fim, com coordenadas): sem travas, horários nem permanências. */
  signature: string;
  plan: PlanResponse;
  /** Tempo de cada par já calculado pelo servidor ("de>para" → segundos). */
  pairs: Map<string, number>;
}

interface BodyPoint {
  id: string;
  lat: number;
  lng: number;
}

interface PlanBody {
  start: BodyPoint;
  stops: BodyPoint[];
  end: BodyPoint | null;
  roundTrip: boolean;
}

const parse = (body: string): PlanBody | null => {
  try {
    return JSON.parse(body) as PlanBody;
  } catch {
    return null;
  }
};

/** Assinatura dos locais do pedido: muda ao trocar, incluir ou tirar um local, e só então. */
export function placesSignature(body: string): string | null {
  const b = parse(body);
  if (!b) return null;
  const point = (p: BodyPoint) => `${p.id}@${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  return [
    point(b.start),
    [...b.stops].map(point).sort().join("|"),
    b.roundTrip ? "ida-e-volta" : b.end ? point(b.end) : "sem-fim",
  ].join("#");
}

/** Guarda a resposta boa do servidor, com o tempo de cada par que ela trouxe. */
export function rememberPlan(body: string, plan: PlanResponse): RememberedPlan | null {
  const b = parse(body);
  const signature = placesSignature(body);
  if (!b || !signature) return null;
  const sequence = [b.start.id, ...plan.order, ...(b.roundTrip ? [b.start.id] : b.end ? [b.end.id] : [])];
  const pairs = new Map<string, number>();
  plan.legSeconds.forEach((seconds, i) => {
    if (sequence[i + 1] !== undefined) pairs.set(`${sequence[i]}>${sequence[i + 1]}`, seconds);
  });
  return { signature, plan, pairs };
}

/**
 * Tempo entre dois locais usando o que o servidor já calculou (o par, ou o par
 * ao contrário) e só estimando por distância o que ainda não se conhece.
 */
export function blendedLegTime(remembered: RememberedPlan | null): LegTimeFn {
  if (!remembered) return estimateLegTime;
  const { pairs, plan } = remembered;
  return (from, to) => {
    const known = pairs.get(`${from.id}>${to.id}`) ?? pairs.get(`${to.id}>${from.id}`);
    return known === undefined ? estimateLegTime(from, to) : { seconds: known, estimated: plan.source.estimated };
  };
}
