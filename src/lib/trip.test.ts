import { freeLegs, moveRow, normalizeBreaks, rowsOf, shiftBreaksAfterRemoval, type RestBreak } from "./breaks";
import { parseSharedRoute, sharedPath, sharedQuery } from "./share-link";
import { computePlan, estimateLegTime } from "./plan";
import { describe, expect, it } from "vitest";
import { placeBeside } from "./floating";
import { planRequestBody } from "./plan-client";
import { angleDelta, bearingDeg, lerpAngle, projectOnLine, remainingFraction, remainingLine, type LngLat } from "./route-progress";
import { isRouteState } from "./route-state";
import {
  hasArrived,
  hasPassed,
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

  it("chega só bem perto do ponto (30 m, até 60 m com GPS impreciso)", () => {
    expect(hasArrived(fix(38.7202, -9.15), S1)).toBe(true); // ~22 m
    expect(hasArrived(fix(38.7205, -9.15), S1)).toBe(false); // ~55 m com precisão boa
    expect(hasArrived(fix(38.7205, -9.15, 0, 60), S1)).toBe(true); // precisão de 60 m alarga o raio
    expect(hasArrived(fix(38.7015, -9.15), S1)).toBe(false); // ~2 km
    // Precisão de 1 km não vira raio de 1 km.
    expect(hasArrived(fix(38.7225, -9.15, 0, 1000), S1)).toBe(false);
  });
  it("passou pelo destino: chegou a até 70 m e agora se afasta", () => {
    expect(hasPassed(45, 70)).toBe(true);
    expect(hasPassed(45, 55)).toBe(false);
    expect(hasPassed(300, 400)).toBe(false);
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

describe("pausas para descanso", () => {
  const stops = [S1, S2];
  const brk = (id: string, after: number, minutes = 15): RestBreak => ({ id, after, minutes });

  it("aparecem na lista antes da parada do trecho delas", () => {
    const rows = rowsOf(stops, [brk("p", 1), brk("q", 2)]);
    expect(rows.map((r) => (r.kind === "stop" ? r.stop.id : r.brk.id))).toEqual(["S1", "p", "S2", "q"]);
  });

  it("arrastar uma pausa muda o trecho; duas juntas não valem", () => {
    const rows = rowsOf(stops, [brk("p", 1)]); // S1, p, S2
    const up = moveRow(rows, 1, 0, 3); // p, S1, S2
    expect(up).toEqual({ ok: true, stopMove: null, breaks: [brk("p", 0)] });
    const two = rowsOf(stops, [brk("p", 1), brk("q", 2)]); // S1, p, S2, q
    expect(moveRow(two, 3, 2, 3)).toEqual({ ok: false, reason: "adjacent" }); // S1, p, q, S2
    // Sem fim, não há trecho depois da última parada.
    expect(moveRow(rows, 1, 2, 2)).toEqual({ ok: false, reason: "edge" });
  });

  it("arrastar uma parada por cima da pausa troca a parada de lugar e a pausa fica", () => {
    const rows = rowsOf(stops, [brk("p", 1)]); // S1, p, S2
    const moved = moveRow(rows, 0, 2, 3); // p, S2, S1
    expect(moved).toEqual({ ok: true, stopMove: { from: 0, to: 1 }, breaks: [brk("p", 0)] });
  });

  it("normaliza: dentro dos trechos, uma por trecho (somando), em ordem", () => {
    expect(normalizeBreaks([brk("a", 5), brk("b", 0)], 2, true)).toEqual([brk("b", 0), brk("a", 2)]);
    expect(normalizeBreaks([brk("a", 1, 10), brk("b", 1, 20)], 2, false)).toEqual([brk("a", 1, 30)]);
    expect(normalizeBreaks([brk("a", 0)], 0, false)).toEqual([]);
    expect(shiftBreaksAfterRemoval([brk("a", 0), brk("b", 2)], 1)).toEqual([brk("a", 0), brk("b", 1)]);
    expect(freeLegs([brk("a", 1)], 3)).toEqual([0, 2]);
  });

  it("somam ao horário de chegada do trecho e ao total", () => {
    const at = new Date(0);
    const plain = computePlan([A, S1, S2, A], "depart", at, estimateLegTime);
    const withBreak = computePlan([A, S1, S2, A], "depart", at, estimateLegTime, new Map([[1, 900]]));
    expect(withBreak.totalSeconds).toBe(plain.totalSeconds + 900);
    expect(withBreak.breakSeconds).toBe(900);
    expect(withBreak.legs[0].arriveAt).toEqual(plain.legs[0].arriveAt);
    expect(withBreak.legs[1].arriveAt.getTime()).toBe(plain.legs[1].arriveAt.getTime() + 900_000);
    expect(withBreak.legs[1].breakSeconds).toBe(900);
  });
});

describe("link compartilhável", () => {
  it("lê o formato de caminho, com fim, sem fim e ida e volta", () => {
    const r = parseSharedRoute("/r/38.7075,-9.1364/-/38.72,-9.15@15/b20/38.75,-9.2", "")!;
    expect(r.start).toEqual({ lat: 38.7075, lng: -9.1364, dwellMinutes: 0 });
    expect(r.end).toBe("none");
    expect(r.items).toEqual([
      { kind: "stop", lat: 38.72, lng: -9.15, dwellMinutes: 15 },
      { kind: "break", minutes: 20 },
      { kind: "stop", lat: 38.75, lng: -9.2, dwellMinutes: 0 },
    ]);
    expect(parseSharedRoute("/r/38.7,-9.1/s/38.72,-9.15", "")!.end).toBe("start");
    expect(parseSharedRoute("/r/38.7,-9.1/38.8,-9.3/38.72,-9.15", "")!.end).toEqual({ lat: 38.8, lng: -9.3, dwellMinutes: 0 });
    // Vírgula codificada também vale.
    expect(parseSharedRoute("/r/38.7%2C-9.1/-/38.72%2C-9.15", "")).not.toBeNull();
  });

  it("lê o formato de parâmetros (p1… ou s1…), com e sem fim", () => {
    const r = parseSharedRoute("/", "?s=38.7,-9.1&p2=38.75,-9.2&p1=38.72,-9.15")!;
    expect(r.end).toBe("none");
    expect(r.items.map((i) => (i.kind === "stop" ? i.lat : 0))).toEqual([38.72, 38.75]);
    expect(parseSharedRoute("/", "?s=38.7,-9.1&e=s&s1=38.72,-9.15")!.end).toBe("start");
  });

  it("recusa qualquer coisa que não seja coordenada, tempo ou pausa (sem HTML, sem texto)", () => {
    expect(parseSharedRoute("/r/38.7,-9.1/-/<script>alert(1)</script>", "")).toBeNull();
    expect(parseSharedRoute("/", "?s=38.7,-9.1&p1=%3Cimg%20src=x%20onerror=alert(1)%3E")).toBeNull();
    expect(parseSharedRoute("/", "?s=javascript:alert(1)")).toBeNull();
    expect(parseSharedRoute("/r/91,0/-/38.72,-9.15", "")).toBeNull(); // latitude fora do mundo
    expect(parseSharedRoute("/r/38.7,-9.1/-/38.72,-9.15@999", "")).toBeNull(); // mais de 12 h
    expect(parseSharedRoute("/r/38.7,-9.1/-/b0", "")).toBeNull();
    expect(parseSharedRoute("/r/%E0%A4%A/-/1,1", "")).toBeNull(); // codificação inválida
    const many = Array.from({ length: 21 }, (_, i) => `38.${i + 10},-9.1`).join("/");
    expect(parseSharedRoute(`/r/38.7,-9.1/-/${many}`, "")).toBeNull(); // mais de 20 paradas
    expect(parseSharedRoute("/", "")).toBeNull();
  });

  it("gera os dois formatos e eles voltam à mesma rota", () => {
    const route = parseSharedRoute("/r/38.70751,-9.13642/s/38.72,-9.15@15/b20/38.75,-9.2", "")!;
    expect(sharedPath(route)).toBe("/r/38.70751,-9.13642/s/38.72,-9.15@15/b20/38.75,-9.2");
    const query = sharedQuery(route);
    expect(query).toBe("/?s=38.70751,-9.13642&e=s&p1=38.72,-9.15@15&p2=b20&p3=38.75,-9.2");
    expect(parseSharedRoute("/", query.slice(1))).toEqual(route);
  });
});

describe("link com hora e travas", () => {
  it("leva a hora de saída/chegada, as travas e as pausas, nos dois formatos", () => {
    const route = {
      start: { lat: 38.7, lng: -9.1, dwellMinutes: 0 },
      end: "start" as const,
      items: [
        { kind: "stop" as const, lat: 38.71, lng: -9.12, dwellMinutes: 15, locked: true },
        { kind: "break" as const, minutes: 20 },
        { kind: "stop" as const, lat: 38.72, lng: -9.13, dwellMinutes: 0 },
      ],
      time: { mode: "arrive" as const, at: "2026-11-19T08:30" },
    };
    const path = sharedPath(route);
    expect(path).toBe("/r/38.7,-9.1/s/38.71,-9.12@15l/b20/38.72,-9.13/a202611190830");
    expect(parseSharedRoute(path, "")).toEqual(route);
    const q = sharedQuery(route);
    expect(q).toContain("t=a202611190830");
    expect(parseSharedRoute("/", q.slice(1))).toEqual(route);
  });
  it("recusa hora impossível e aceita link sem hora", () => {
    expect(parseSharedRoute("/r/38.7,-9.1/-/38.71,-9.12/d202602311200", "")).toBeNull();
    expect(parseSharedRoute("/r/38.7,-9.1/-/38.71,-9.12", "")?.time).toBeNull();
  });
});

describe("mão da via", () => {
  // Ida para o norte e volta para o sul pela mesma rua, quase no mesmo lugar.
  const there: [number, number][] = [
    [-9.14, 38.7],
    [-9.14, 38.71],
  ];
  const back: [number, number][] = [
    [-9.13995, 38.71],
    [-9.13995, 38.7],
  ];
  const line = [...there, ...back];
  it("com a direção do carro, gruda no sentido certo da rua", () => {
    const point: [number, number] = [-9.13997, 38.705];
    expect(projectOnLine(point, line, 0)?.index).toBe(0);
    expect(projectOnLine(point, line, 180)?.index).toBe(2);
    expect(projectOnLine(point, line, 180)?.against).toBe(false);
  });
  it("marca quando o carro anda contra a linha", () => {
    expect(projectOnLine([-9.14, 38.705], there, 180)?.against).toBe(true);
    expect(projectOnLine([-9.14, 38.705], there, null)?.against).toBe(false);
  });
});

describe("chegada numa parada específica", () => {
  it("a saída é calculada para chegar na parada escolhida na hora pedida", async () => {
    const { computePlan } = await import("./plan");
    const p = (id: string, dwell = 0) => ({ id, label: id, lat: 0, lng: 0, source: "coords" as const, confidence: 1, dwellMinutes: dwell });
    const seq = [p("S"), p("A", 10), p("B", 5), p("E")];
    const leg = () => ({ seconds: 600, estimated: false });
    const at = new Date("2026-11-20T12:00:00");
    const plan = computePlan(seq, "arrive", at, leg, new Map([[1, 900]]), 1);
    // Chegar em B às 12:00: 10 min até A + 10 min lá + 15 min de pausa + 10 min até B = 45 min antes.
    expect(plan.legs[1].arriveAt.getTime()).toBe(at.getTime());
    expect(plan.departAt.getTime()).toBe(at.getTime() - 45 * 60_000);
  });
});

describe("link com a hora de chegada numa parada", () => {
  it("marca a parada com ^ e volta na leitura", () => {
    const route = {
      start: { lat: 38.7, lng: -9.1, dwellMinutes: 0 },
      end: "none" as const,
      items: [
        { kind: "stop" as const, lat: 38.71, lng: -9.12, dwellMinutes: 0 },
        { kind: "stop" as const, lat: 38.72, lng: -9.13, dwellMinutes: 10, locked: true, arriveHere: true },
      ],
      time: { mode: "arrive" as const, at: "2026-11-20T15:00" },
    };
    const path = sharedPath(route);
    expect(path).toBe("/r/38.7,-9.1/-/38.71,-9.12/38.72,-9.13@10lc/a202611201500");
    expect(parseSharedRoute(path, "")).toEqual(route);
  });
});

describe("link: letras no lugar de símbolos", () => {
  it("ainda lê os símbolos antigos (! e ^) e gera letras (l e c)", () => {
    const old = parseSharedRoute("/r/38.7,-9.1/-/38.72,-9.13@10!^/a202611201500", "");
    const neu = parseSharedRoute("/r/38.7,-9.1/-/38.72,-9.13@10lc/a202611201500", "");
    expect(old).toEqual(neu);
    expect(neu?.items[0]).toMatchObject({ locked: true, arriveHere: true });
  });
});
