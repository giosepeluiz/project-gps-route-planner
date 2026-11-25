import { describe, expect, it } from "vitest";
import { blendedLegTime, placesSignature, rememberPlan } from "./plan-memory";
import type { PlanResponse } from "./server/plan";
import type { Place } from "./types";

const place = (id: string, lat: number, lng: number): Place => ({ id, label: id, lat, lng, source: "coords", confidence: 1, dwellMinutes: 0 });
const body = (locks: Record<string, number> = {}, dwell = 0) =>
  JSON.stringify({
    start: { id: "S", lat: 38.58, lng: -8.93 },
    stops: [
      { id: "A", lat: 37.1, lng: -8.35, dwellMin: dwell },
      { id: "B", lat: 37.13, lng: -8.5 },
    ],
    end: null,
    roundTrip: true,
    locks,
    mode: "depart",
    at: null,
  });
const plan = { order: ["A", "B"], legSeconds: [7500, 1500, 7600] } as unknown as PlanResponse;

describe("memória do último cálculo do servidor", () => {
  it("a assinatura ignora travas, permanência e horário, mas muda com os locais", () => {
    expect(placesSignature(body({ A: 0 }, 30))).toBe(placesSignature(body({}, 0)));
    const moved = body().replace("37.13", "37.14");
    expect(placesSignature(moved)).not.toBe(placesSignature(body()));
  });

  it("guarda o tempo de cada par e usa o que já se sabe (inclusive o par ao contrário)", () => {
    const remembered = rememberPlan(body(), { ...plan, source: { estimated: false } } as PlanResponse)!;
    const time = blendedLegTime(remembered);
    const S = place("S", 38.58, -8.93);
    const A = place("A", 37.1, -8.35);
    const B = place("B", 37.13, -8.5);
    expect(time(S, A)).toEqual({ seconds: 7500, estimated: false });
    expect(time(A, B).seconds).toBe(1500);
    expect(time(B, A).seconds).toBe(1500); // par ao contrário
    expect(time(B, S).seconds).toBe(7600); // volta ao início
    // Par desconhecido: estimativa por distância.
    const C = place("C", 38.0, -9.0);
    expect(time(A, C).estimated).toBe(true);
  });

  it("pares novos são estimados na mesma escala do que o servidor já calculou", () => {
    const remembered = rememberPlan(body(), { ...plan, source: { estimated: false } } as PlanResponse)!;
    // Estrada: o servidor andou bem mais rápido que a linha reta a 35 km/h.
    expect(remembered.scale).toBeLessThan(0.6);
    const raw = blendedLegTime(null)(place("A", 37.1, -8.35), place("C", 38.0, -9.0));
    const scaled = blendedLegTime(remembered)(place("A", 37.1, -8.35), place("C", 38.0, -9.0));
    expect(scaled.estimated).toBe(true);
    expect(scaled.seconds).toBeLessThan(raw.seconds * 0.6);
    expect(scaled.seconds).toBeGreaterThan(raw.seconds / 6.1);
  });

  it("sem memória, é a estimativa por distância", () => {
    expect(blendedLegTime(null)(place("S", 38.58, -8.93), place("A", 37.1, -8.35)).estimated).toBe(true);
  });
});
