import { describe, expect, it } from "vitest";
import { placeBeside } from "./floating";
import { hasArrived, remainingRoute, routeMeters, shouldReplan, tripTarget, type Fix } from "./trip";
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
