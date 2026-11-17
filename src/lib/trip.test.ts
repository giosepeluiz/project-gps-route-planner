import { describe, expect, it } from "vitest";
import { placeBeside } from "./floating";
import { planRequestBody } from "./plan-client";
import { angleDelta, bearingDeg, lerpAngle, projectOnLine, remainingFraction, remainingLine, type LngLat } from "./route-progress";
import { isRouteState } from "./route-state";
import {
  hasArrived,
  headingFrom,
  isOffRoute,
  logFix,
  logGo,
  logStop,
  newTripLog,
  remainingRoute,
  routeMeters,
  shouldReplan,
  shouldReroute,
  snapRadius,
  summarizeTrip,
  tripTarget,
  type Fix,
} from "./trip";
import type { Place } from "./types";

const place = (id: string, lat: number, lng: number): Place => ({
  id,
  label: id,
  lat,
  lng,
  source: "pin",
  confidence: 1,
  dwellMinutes: 0,
});

const A = place("A", 38.7, -9.14);
const S1 = place("S1", 38.72, -9.15);
const S2 = place("S2", 38.75, -9.2);
const fix = (lat: number, lng: number, at = 0, accuracy = 10): Fix => ({ lat, lng, at, accuracy });

describe("viagem", () => {
  it("o destino é a primeira parada pendente e, no fim, o ponto final", () => {
    expect(tripTarget([S1, S2], new Set(), A)?.id).toBe("S1");
    expect(tripTarget([S1, S2], new Set(["S1"]), A)?.id).toBe("S2");
    expect(tripTarget([S1, S2], new Set(["S1", "S2"]), A)?.id).toBe("A");
    expect(tripTarget([S1, S2], new Set(["S1", "S2"]), null)).toBeNull();
  });

  it("chega dentro do raio, que cresce com GPS impreciso (até um limite)", () => {
    expect(hasArrived(fix(38.7203, -9.15), S1)).toBe(true); // ~33 m
    expect(hasArrived(fix(38.7015, -9.15), S1)).toBe(false); // ~2 km
    // ~110 m: fora do raio de 80 m, dentro com precisão de 120 m.
    expect(hasArrived(fix(38.721, -9.15), S1)).toBe(false);
    expect(hasArrived(fix(38.721, -9.15, 0, 120), S1)).toBe(true);
    // Precisão de 1 km não vira raio de 1 km.
    expect(hasArrived(fix(38.7225, -9.15, 0, 1000), S1)).toBe(false);
  });

  it("recalcula na primeira leitura, depois só com tempo e deslocamento", () => {
    const first = fix(38.7, -9.14, 0);
    expect(shouldReplan(null, first)).toBe(true);
    expect(shouldReplan(first, fix(38.705, -9.14, 60_000))).toBe(false); // cedo demais
    expect(shouldReplan(first, fix(38.7001, -9.14, 300_000))).toBe(false); // parado
    expect(shouldReplan(first, fix(38.705, -9.14, 130_000))).toBe(true);
    expect(shouldReplan(first, fix(38.74, -9.14, 10_000))).toBe(true); // andou muito
  });

  it("a rota que falta trava as paradas pendentes na ordem atual", () => {
    const here = place("aqui", 38.71, -9.14);
    const route = remainingRoute(here, [S2, S1], A);
    expect(route.locks).toEqual({ S2: 0, S1: 1 });
    expect(route.start.id).toBe("aqui");
    expect(route.end?.id).toBe("A");
    expect(route.endSame).toBe(false);
  });

  it("soma a distância pelas ruas ou estima pela linha reta", () => {
    expect(routeMeters([A, S1, A], [{ meters: 3000 }, { meters: 3200 }])).toEqual({ meters: 6200, estimated: false });
    const estimate = routeMeters([A, S1], null);
    expect(estimate.estimated).toBe(true);
    expect(estimate.meters).toBeGreaterThan(2000);
    // Trechos que não batem com a sequência não valem.
    expect(routeMeters([A, S1, S2], [{ meters: 1 }]).estimated).toBe(true);
  });
});

describe("balão flutuante", () => {
  const viewport = { width: 1000, height: 800 };
  const tip = { width: 280, height: 150 };

  it("fica à direita quando cabe", () => {
    const at = placeBeside({ top: 20, left: 16, width: 370, height: 300 }, tip, viewport);
    expect(at).toEqual({ side: "right", top: 20, left: 398 });
  });

  it("vai para a esquerda quando o bloco está na borda direita", () => {
    const at = placeBeside({ top: 20, left: 614, width: 370, height: 300 }, tip, viewport);
    expect(at.side).toBe("left");
    expect(at.left).toBe(614 - 12 - 280);
  });

  it("no celular (largura toda) usa acima ou abaixo, sempre dentro da tela", () => {
    const phone = { width: 375, height: 812 };
    const at = placeBeside({ top: 500, left: 0, width: 375, height: 48 }, tip, phone);
    expect(at.side).toBe("bottom");
    const high = placeBeside({ top: 700, left: 0, width: 375, height: 48 }, tip, phone, ["bottom", "top"]);
    expect(high.side).toBe("top");
    expect(high.left).toBeGreaterThanOrEqual(8);
    expect(high.left + tip.width).toBeLessThanOrEqual(375 - 8);
  });
});

describe("progresso na rota", () => {
  // Uma via reta para leste, ~1.1 km, e depois para norte.
  const line: LngLat[] = [
    [-9.15, 38.7],
    [-9.1373, 38.7],
    [-9.1373, 38.709],
  ];

  it("projeta a posição na via, mede o desvio e o que falta", () => {
    const p = projectOnLine([-9.14, 38.7003], line)!;
    expect(p.index).toBe(0);
    expect(p.point[1]).toBeCloseTo(38.7, 6);
    expect(p.distanceM).toBeGreaterThan(25);
    expect(p.distanceM).toBeLessThan(40);
    expect(Math.round(p.bearing)).toBe(90);
    expect(remainingFraction(p)).toBeGreaterThan(0.5);
    expect(remainingFraction(p)).toBeLessThan(0.7);
    const rest = remainingLine(line, p);
    expect(rest[0]).toEqual(p.point);
    expect(rest).toHaveLength(3);
  });

  it("no segundo segmento a direção é para norte", () => {
    const p = projectOnLine([-9.1373, 38.705], line)!;
    expect(p.index).toBe(1);
    expect(Math.round(p.bearing)).toBe(0);
    expect(remainingLine(line, p)).toHaveLength(2);
  });

  it("ângulos: direção, diferença e interpolação pelo lado mais curto", () => {
    expect(Math.round(bearingDeg([0, 0], [0, 1]))).toBe(0);
    expect(Math.round(bearingDeg([0, 0], [-1, 0]))).toBe(270);
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 6);
  });

  it("desvio: raio de encaixe e de saída da rota crescem com GPS impreciso, com limite", () => {
    expect(snapRadius(5)).toBe(45);
    expect(snapRadius(60)).toBe(72);
    expect(snapRadius(500)).toBe(90);
    expect(isOffRoute(40, 10)).toBe(false);
    expect(isOffRoute(80, 10)).toBe(true);
    expect(isOffRoute(80, 70)).toBe(false); // GPS de 70 m: tolera até 105 m
    expect(isOffRoute(200, 500)).toBe(true); // limite de 150 m
  });

  it("recalcula por desvio só depois de 2 leituras fora e no máximo a cada 15 s", () => {
    const last = fix(38.7, -9.14, 0);
    expect(shouldReroute(last, fix(38.7, -9.14, 20_000), 1)).toBe(false);
    expect(shouldReroute(last, fix(38.7, -9.14, 20_000), 2)).toBe(true);
    expect(shouldReroute(last, fix(38.7, -9.14, 10_000), 3)).toBe(false);
    expect(shouldReroute(null, fix(38.7, -9.14, 0), 2)).toBe(true);
  });

  it("direção do carro: GPS em movimento, senão o deslocamento, senão nada", () => {
    const a = fix(38.7, -9.14, 0);
    const north = fix(38.7005, -9.14, 1000);
    expect(headingFrom(a, north, { heading: 123, speed: 10 })).toBe(123);
    expect(Math.round(headingFrom(a, north, { heading: null, speed: null })!)).toBe(0);
    expect(headingFrom(a, fix(38.70001, -9.14, 1000), { heading: 50, speed: 0.2 })).toBeNull();
  });
});

describe("estatísticas da viagem", () => {
  it("soma o caminho sem o tremido do GPS e desconta o tempo parado", () => {
    let log = newTripLog(0);
    log = logFix(log, fix(38.7, -9.14, 0, 5));
    log = logFix(log, fix(38.70002, -9.14, 1000, 5)); // ~2 m: tremido
    expect(log.meters).toBe(0);
    log = logFix(log, fix(38.709, -9.14, 60_000, 5)); // ~1 km
    expect(log.meters).toBeGreaterThan(990);
    log = logStop(log, 60_000);
    log = logGo(log, 360_000); // 5 min parado
    // Depois da parada, a primeira leitura só recomeça a soma (sem salto).
    log = logFix(log, fix(38.8, -9.14, 361_000, 5));
    expect(log.meters).toBeLessThan(1010);
    const summary = summarizeTrip(log, { seconds: 400, arriveAt: 400_000, meters: 1200 }, 420_000, 1);
    expect(summary.actualSeconds).toBe(420);
    expect(summary.stoppedSeconds).toBe(300);
    expect(summary.averageKmh).toBeCloseTo((log.meters / 120) * 3.6, 5);
    expect(summary.plannedMeters).toBe(1200);
    expect(summary.stopsDone).toBe(1);
  });

  it("sem previsão, os campos previstos ficam vazios; quase sem andar, sem velocidade média", () => {
    const summary = summarizeTrip(newTripLog(0), null, 30_000, 0);
    expect(summary.plannedSeconds).toBeNull();
    expect(summary.plannedArriveAt).toBeNull();
    expect(summary.averageKmh).toBeNull();
  });
});

describe("pedido da rota e estado guardado", () => {
  it("envia a direção do carro só quando existe, de 0 a 359", () => {
    const base = { start: A, stops: [S1], end: null, endSame: true, locks: {}, mode: "depart" as const, dateTime: null };
    expect(planRequestBody(base)).not.toHaveProperty("heading");
    expect(planRequestBody({ ...base, heading: 359.7 })).toHaveProperty("heading", 0);
    expect(planRequestBody({ ...base, heading: -10 })).toHaveProperty("heading", 350);
  });

  it("guarda a data e hora com a rota", () => {
    const route = { start: A, endSame: true, end: null, stops: [S1], timeMode: "depart" };
    expect(isRouteState({ ...route, dateTime: "2026-11-18T08:30" })).toBe(true);
    expect(isRouteState({ ...route, dateTime: null })).toBe(true);
    expect(isRouteState(route)).toBe(true);
    expect(isRouteState({ ...route, dateTime: 5 })).toBe(false);
  });
});
