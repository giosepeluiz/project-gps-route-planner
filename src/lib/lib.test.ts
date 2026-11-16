import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatKm,
  formatTime,
  formatTimeWithDay,
  pluralStops,
  toLocalInputValue,
} from "./format";
import { estimateSeconds, haversineMeters, parseDecimalPair } from "./geo";
import { getFallbackStyleUrl } from "./map-style";
import {
  FIXTURE_PLACES as P,
  MOCK_ORDERED_STOPS,
  MOCK_START,
  MOCK_TYPED_STOPS,
  mockLegTime,
} from "./mock-data";
import { computePlan, sequenceSeconds } from "./plan";
import { addStop, isApproximate, MAX_STOPS, MSG_LIMIT } from "./stops";
import type { Place } from "./types";

function place(id: string, lat: number, lng: number): Place {
  return { id, label: id, lat, lng, source: "pin", confidence: 1, dwellMinutes: 0 };
}

describe("format", () => {
  it("formata durações", () => {
    expect(formatDuration(7984)).toBe("2 h 13 min");
    expect(formatDuration(2700)).toBe("45 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(0)).toBe("0 min");
  });

  it("formata horas e datas locais", () => {
    const d = new Date(2026, 10, 17, 9, 5);
    expect(formatTime(d)).toBe("09:05");
    expect(toLocalInputValue(d)).toBe("2026-11-17T09:05");
    expect(formatTimeWithDay(d, d)).toBe("09:05");
    expect(formatTimeWithDay(new Date(2026, 10, 18, 0, 40), d)).toBe("00:40 (18/11)");
  });

  it("usa ponto decimal e plural correto", () => {
    expect(formatKm(12_540)).toBe("12.5 km");
    expect(pluralStops(1)).toBe("1 parada");
    expect(pluralStops(4)).toBe("4 paradas");
  });
});

describe("geo", () => {
  it("calcula a distância Barreiro → Belém", () => {
    const meters = haversineMeters(P.B, P.Be);
    expect(meters).toBeGreaterThan(12_000);
    expect(meters).toBeLessThan(13_500);
  });

  it("estima o tempo por distância (haversine × 1.4 ÷ 35 km/h)", () => {
    const meters = haversineMeters(P.B, P.Be);
    expect(estimateSeconds(P.B, P.Be)).toBe(Math.round((meters * 1.4) / (35_000 / 3600)));
  });

  it("lê pares decimais simples", () => {
    expect(parseDecimalPair("38.7074, -9.1373")).toEqual({ lat: 38.7074, lng: -9.1373 });
    expect(parseDecimalPair("38.7074 -9.1373")).toEqual({ lat: 38.7074, lng: -9.1373 });
    expect(parseDecimalPair("Praça do Comércio")).toBeNull();
    expect(parseDecimalPair("95, 10")).toBeNull();
  });
});

describe("plano com os fixtures das 09:00", () => {
  const depart = new Date(2026, 10, 17, 9, 0);

  it("ordem digitada soma 9419 s e a ótima 7984 s", () => {
    const typed = [MOCK_START, ...MOCK_TYPED_STOPS, MOCK_START];
    const best = [MOCK_START, ...MOCK_ORDERED_STOPS, MOCK_START];
    expect(sequenceSeconds(typed, mockLegTime)).toBe(9419);
    expect(sequenceSeconds(best, mockLegTime)).toBe(7984);
  });

  it("modo Sair em: calcula as chegadas", () => {
    const plan = computePlan([MOCK_START, ...MOCK_ORDERED_STOPS, MOCK_START], "depart", depart, mockLegTime);
    expect(plan.totalSeconds).toBe(7984);
    expect(plan.departAt).toEqual(depart);
    expect(plan.legs.map((l) => l.seconds)).toEqual([2012, 1493, 1894, 2585]);
    expect(plan.arriveAt.getTime()).toBe(depart.getTime() + 7984_000);
    expect(plan.hasEstimates).toBe(false);
  });

  it("modo Chegar até: saída = chegada − duração", () => {
    const arrive = new Date(2026, 10, 17, 12, 0);
    const plan = computePlan([MOCK_START, ...MOCK_ORDERED_STOPS, MOCK_START], "arrive", arrive, mockLegTime);
    expect(plan.arriveAt).toEqual(arrive);
    expect(plan.departAt.getTime()).toBe(arrive.getTime() - 7984_000);
  });

  it("caminho aberto (sem voltar ao início) e locais fora dos fixtures", () => {
    const open = computePlan([MOCK_START, ...MOCK_ORDERED_STOPS], "depart", depart, mockLegTime);
    expect(open.totalSeconds).toBe(7984 - 2585);

    const novo = place("novo", 38.72, -9.15);
    const plan = computePlan([MOCK_START, novo], "depart", depart, mockLegTime);
    expect(plan.hasEstimates).toBe(true);
    expect(plan.legs[0].estimated).toBe(true);
  });
});

describe("paradas", () => {
  it("bloqueia a 21ª parada", () => {
    let stops: Place[] = [];
    for (let i = 0; i < MAX_STOPS; i++) {
      const result = addStop(stops, place(`p${i}`, 38 + i * 0.01, -9));
      expect(result.ok).toBe(true);
      if (result.ok) stops = result.stops;
    }
    expect(stops).toHaveLength(20);
    const extra = addStop(stops, place("extra", 40, -8));
    expect(extra).toEqual({ ok: false, reason: "limit", message: MSG_LIMIT });
  });

  it("avisa de ordem aproximada a partir de 11", () => {
    expect(isApproximate(10)).toBe(false);
    expect(isApproximate(11)).toBe(true);
    expect(isApproximate(20)).toBe(true);
  });

  it("ignora duplicados dentro de 20 m, inclusive contra início e fim", () => {
    const a = place("a", 38.7, -9.1);
    const perto = place("b", 38.7001, -9.1); // ~11 m
    const longe = place("c", 38.7005, -9.1); // ~56 m
    expect(addStop([a], perto).ok).toBe(false);
    expect(addStop([a], longe).ok).toBe(true);
    expect(addStop([], perto, [a])).toMatchObject({ ok: false, reason: "duplicate" });
  });
});

describe("estilo reserva do mapa", () => {
  it("fica desligado sem variáveis", () => {
    expect(getFallbackStyleUrl({})).toBeNull();
  });

  it("prefere a URL explícita e monta a do MapTiler pela chave", () => {
    expect(getFallbackStyleUrl({ MAP_FALLBACK_STYLE_URL: "https://x/style.json", MAPTILER_KEY: "k" })).toBe(
      "https://x/style.json",
    );
    expect(getFallbackStyleUrl({ MAPTILER_KEY: "a b" })).toBe(
      "https://api.maptiler.com/maps/streets-v2/style.json?key=a%20b",
    );
  });
});
