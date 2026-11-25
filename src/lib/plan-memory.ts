/**
 * Memória do último cálculo bom do servidor. Enquanto uma resposta nova não chega
 * (ou se ela falha), a tela não pode voltar para a estimativa em linha reta, que
 * dá tempos absurdos: ela segue com o que o servidor já calculou.
 */
import type { PlanResponse } from "./server/plan";
import { estimateSeconds } from "./geo";
import { estimateLegTime } from "./plan";
import type { LegTimeFn } from "./types";

export interface RememberedPlan {
  /** Assinatura dos locais (início, paradas e fim, com coordenadas): sem travas, horários nem permanências. */
  signature: string;
  plan: PlanResponse;
  /** Tempo de cada par já calculado pelo servidor ("de>para" → segundos). */
  pairs: Map<string, number>;
  /**
   * Quanto o tempo real do servidor foi menor (ou maior) que a estimativa em linha reta, na mediana dos
   * pares conhecidos. Serve para estimar os pares novos na mesma escala (a estimativa pura, a 35 km/h,
   * erra feio em viagens longas de estrada).
   */
  scale: number;
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
  avoidTolls?: boolean;
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
    // Com e sem pedágio os tempos mudam: não vale reaproveitar os de um para o outro.
    b.avoidTolls ? "sem-pedagio" : "com-pedagio",
  ].join("#");
}

/** Guarda a resposta boa do servidor, com o tempo de cada par que ela trouxe. */
export function rememberPlan(body: string, plan: PlanResponse): RememberedPlan | null {
  const b = parse(body);
  const signature = placesSignature(body);
  if (!b || !signature) return null;
  const sequence = [b.start.id, ...plan.order, ...(b.roundTrip ? [b.start.id] : b.end ? [b.end.id] : [])];
  const pairs = new Map<string, number>();
  const points = new Map<string, BodyPoint>([[b.start.id, b.start], ...b.stops.map((s): [string, BodyPoint] => [s.id, s]), ...(b.end ? [[b.end.id, b.end] as [string, BodyPoint]] : [])]);
  const ratios: number[] = [];
  plan.legSeconds.forEach((seconds, i) => {
    const from = sequence[i];
    const to = sequence[i + 1];
    if (to === undefined) return;
    pairs.set(`${from}>${to}`, seconds);
    const a = points.get(from);
    const c = points.get(to);
    if (a && c && from !== to) {
      const estimate = estimateSeconds(a, c);
      if (estimate > 0 && seconds > 0) ratios.push(seconds / estimate);
    }
  });
  ratios.sort((x, y) => x - y);
  const middle = ratios.length === 0 ? 1 : ratios[Math.floor(ratios.length / 2)];
  // Limites: nunca mais lento que o dobro da estimativa, nem mais de 6 vezes mais rápido.
  const scale = Math.min(2, Math.max(1 / 6, middle));
  return { signature, plan, pairs, scale };
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
    if (known !== undefined) return { seconds: known, estimated: plan.source.estimated };
    const raw = estimateLegTime(from, to);
    return { seconds: Math.round(raw.seconds * remembered.scale), estimated: true };
  };
}
