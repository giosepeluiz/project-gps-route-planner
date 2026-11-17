import { describe, expect, it } from "vitest";
import { GOOGLE_WAYPOINTS_MOBILE, googleMapsLinks, routeText, wazeLink } from "./export";
import { FIXTURE_PLACES as P, mockLegTime } from "./mock-data";
import { dropTarget, freeRect, placeBlock, sheetOrder } from "./block-layout";
import { overlayPadding } from "./map-padding";
import { computePlan } from "./plan";
import {
  BLOCK_IDS,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  EDGE_MARGIN,
  FONT_PX,
  normalizeLayout,
  normalizeSettings,
  resolveTheme,
  SETTINGS_BOOT_SCRIPT,
} from "./settings";

const allBlocks = (layout: ReturnType<typeof normalizeLayout>) =>
  [...layout.left, ...layout.right, ...Object.keys(layout.free)].sort();

describe("configurações", () => {
  it("valores inválidos ou ausentes caem no padrão (texto pequeno)", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("lixo")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ version: 2, theme: "roxo", fontSize: 99, defaultDwellMinutes: -5 })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(DEFAULT_SETTINGS.fontSize).toBe("sm");
  });

  it("mantém as escolhas válidas", () => {
    const saved = { version: 2, theme: "dark", fontSize: "xl", defaultDwellMinutes: 15 };
    expect(normalizeSettings(saved)).toMatchObject(saved);
    expect(normalizeSettings({ version: 2, defaultDwellMinutes: 99_999 }).defaultDwellMinutes).toBe(720);
  });

  it("formato antigo: guarda o tema, mas a fonte volta ao pequeno e os blocos ao lugar padrão", () => {
    const old = normalizeSettings({ theme: "dark", fontSize: "md", panelSide: "left", blockOrder: ["resumo"] });
    expect(old.theme).toBe("dark");
    expect(old.fontSize).toBe("sm");
    expect(old.layout).toEqual(DEFAULT_LAYOUT);
  });

  it("posição dos blocos: cada bloco uma vez só, e os que faltam voltam ao padrão", () => {
    const layout = normalizeLayout({
      left: ["resumo", "xpto", "resumo"],
      right: ["resumo", "inicio"],
      free: { inicio: { h: "left", x: 10, v: "top", y: 10 }, acoes: { h: "meio" } },
    });
    expect(layout.left).toEqual(["resumo"]);
    expect(layout.right).toEqual(["inicio", "paradas", "acoes"]);
    expect(layout.free).toEqual({});
    expect(allBlocks(layout)).toEqual([...BLOCK_IDS].sort());
  });

  it("tema do sistema segue a preferência do aparelho", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("o texto pequeno é a base de 14 px", () => {
    expect(FONT_PX.sm).toBe(14);
  });

  it("o script inicial aplica tema e fonte antes da primeira pintura", () => {
    const run = (stored: string | null, systemDark: boolean) => {
      const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
      const scope = {
        localStorage: { getItem: () => stored },
        document: { documentElement: root },
        matchMedia: () => ({ matches: systemDark }),
      };
      new Function("localStorage", "document", "matchMedia", SETTINGS_BOOT_SCRIPT)(
        scope.localStorage,
        scope.document,
        scope.matchMedia,
      );
      return root;
    };
    expect(run(null, true).dataset.theme).toBe("dark");
    expect(run(null, false).dataset.theme).toBe("light");
    expect(run(null, false).style.fontSize).toBe(`${FONT_PX.sm}px`);
    const saved = run(JSON.stringify({ version: 2, theme: "light", fontSize: "xl" }), true);
    expect(saved.dataset.theme).toBe("light");
    expect(saved.style.fontSize).toBe(`${FONT_PX.xl}px`);
    // Formato antigo: o texto volta ao pequeno.
    expect(run(JSON.stringify({ theme: "light", fontSize: "xl" }), true).style.fontSize).toBe(`${FONT_PX.sm}px`);
    // Armazenamento corrompido não quebra a página.
    expect(run("{não é json", true).dataset.theme).toBe("dark");
  });
});

describe("blocos arrastáveis", () => {
  const viewport = { width: 1400, height: 900 };
  const size = { width: 322, height: 200 };
  const noDocks = { left: [], right: [] };

  it("perto da borda lateral, gruda na coluna, na posição em que foi solto", () => {
    const target = dropTarget({
      rect: { left: viewport.width - 322 - 30, top: 300, ...size },
      viewport,
      dockMids: { left: [], right: [100, 350, 600] },
    });
    // Centro em 400: fica depois do bloco do meio (350) e antes do último (600).
    expect(target).toEqual({ kind: "dock", side: "right", index: 2 });
    expect(dropTarget({ rect: { left: 40, top: 300, ...size }, viewport, dockMids: noDocks })).toEqual({
      kind: "dock",
      side: "left",
      index: 0,
    });
  });

  it("no meio da tela fica solto; perto do topo ou da base gruda na margem", () => {
    const middle = dropTarget({ rect: { left: 500, top: 300, ...size }, viewport, dockMids: noDocks });
    expect(middle).toEqual({ kind: "free", position: { h: "left", x: 500, v: "top", y: 300 } });

    const nearBottom = dropTarget({ rect: { left: 900, top: 900 - 200 - 30, ...size }, viewport, dockMids: noDocks });
    expect(nearBottom).toEqual({ kind: "free", position: { h: "right", x: 1400 - 900 - 322, v: "bottom", y: EDGE_MARGIN } });

    // Largado parcialmente fora da tela, volta para dentro.
    const outside = dropTarget({ rect: { left: 400, top: -150, ...size }, viewport, dockMids: noDocks });
    expect(outside).toEqual({ kind: "free", position: { h: "left", x: 400, v: "top", y: EDGE_MARGIN } });
    if (outside.kind === "free") {
      expect(freeRect(outside.position, size, viewport)).toEqual({ left: 400, top: EDGE_MARGIN, ...size });
    }
  });

  it("mover um bloco o tira do lugar antigo", () => {
    const moved = placeBlock(DEFAULT_LAYOUT, "resumo", { kind: "dock", side: "right", index: 1 });
    expect(moved.right).toEqual(["inicio", "resumo", "paradas", "acoes"]);
    expect(moved.free.resumo).toBeUndefined();
    const back = placeBlock(moved, "inicio", { kind: "free", position: { h: "left", x: 16, v: "top", y: 16 } });
    expect(back.right).toEqual(["resumo", "paradas", "acoes"]);
    expect(back.free.inicio).toEqual({ h: "left", x: 16, v: "top", y: 16 });
    expect(allBlocks(normalizeLayout(back))).toEqual([...BLOCK_IDS].sort());
  });

  it("no celular, a gaveta segue a ordem das colunas e depois os soltos", () => {
    expect(sheetOrder(DEFAULT_LAYOUT, BLOCK_IDS)).toEqual(["inicio", "paradas", "acoes", "resumo"]);
  });
});

describe("enquadramento da rota com os blocos", () => {
  const map = { left: 0, top: 0, right: 2000, bottom: 840 };

  it("caso da captura: Resumo alto no canto sai pela lateral, não pela base inteira", () => {
    const pad = overlayPadding(map, [
      { left: 1748, top: 36, right: 1994, bottom: 760 }, // painel à direita
      { left: 36, top: 356, right: 282, bottom: 795 }, // Resumo alto embaixo à esquerda
    ]);
    expect(pad.right).toBe(2000 - 1748 + 32);
    expect(pad.left).toBe(282 + 32);
    expect(pad.bottom).toBe(48);
  });

  it("bloco largo e baixo no rodapé sai pela base; bloco fora do mapa não conta", () => {
    const pad = overlayPadding(map, [
      { left: 400, top: 700, right: 1600, bottom: 830 },
      { left: 2100, top: 0, right: 2400, bottom: 300 },
    ]);
    expect(pad).toEqual({ top: 48, left: 48, right: 48, bottom: 840 - 700 + 32 });
  });
});

describe("tempo de permanência", () => {
  const depart = new Date(2026, 10, 17, 9, 0);
  const withDwell = (place: typeof P.CC, minutes: number) => ({ ...place, dwellMinutes: minutes });

  it("soma a permanência das paradas no total e nos horários", () => {
    const base = computePlan([P.B, P.CC, P.Be, P.B], "depart", depart, mockLegTime);
    const plan = computePlan([P.B, withDwell(P.CC, 15), withDwell(P.Be, 30), P.B], "depart", depart, mockLegTime);
    expect(plan.driveSeconds).toBe(base.driveSeconds);
    expect(plan.dwellSeconds).toBe(45 * 60);
    expect(plan.totalSeconds).toBe(base.totalSeconds + 45 * 60);
    // Chega na primeira parada no mesmo horário, sai 15 min depois.
    expect(plan.legs[0].arriveAt).toEqual(base.legs[0].arriveAt);
    expect(plan.legs[0].leaveAt.getTime() - plan.legs[0].arriveAt.getTime()).toBe(15 * 60_000);
    expect(plan.legs[1].arriveAt.getTime() - base.legs[1].arriveAt.getTime()).toBe(15 * 60_000);
    expect(plan.arriveAt.getTime() - base.arriveAt.getTime()).toBe(45 * 60_000);
  });

  it("no Chegar até, a saída antecipa a permanência; o último local não conta", () => {
    const arrive = new Date(2026, 10, 17, 18, 0);
    const plan = computePlan([P.B, withDwell(P.CC, 20), withDwell(P.Be, 60)], "arrive", arrive, mockLegTime);
    // A rota termina em Belém: a hora lá não entra no total.
    expect(plan.dwellSeconds).toBe(20 * 60);
    expect(plan.arriveAt).toEqual(arrive);
    expect(plan.departAt.getTime()).toBe(arrive.getTime() - plan.totalSeconds * 1000);
  });

  it("valores inválidos de permanência viram zero", () => {
    const plan = computePlan([P.B, withDwell(P.CC, Number.NaN), withDwell(P.Be, -10), P.B], "depart", depart, mockLegTime);
    expect(plan.dwellSeconds).toBe(0);
  });

  it("o texto da rota mostra quanto tempo fica em cada parada", () => {
    const plan = computePlan([P.B, withDwell(P.CC, 15), P.B], "depart", depart, mockLegTime);
    const lines = routeText(P.B, plan, 1, true, []).split("\n");
    expect(lines[2]).toBe("1. Costa da Caparica (chega 09:33, fica 15 min, sai 09:48)");
  });
});

describe("ações de saída", () => {
  const point = (i: number) => ({ lat: 38 + i * 0.01, lng: -9 - i * 0.01 });

  it("Google Maps: origem, destino e paradas na ordem", () => {
    const [link] = googleMapsLinks([P.B, P.CC, P.Be, P.PN, P.B]);
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(url.searchParams.get("origin")).toBe("38.661328,-9.075855");
    expect(url.searchParams.get("destination")).toBe("38.661328,-9.075855");
    expect(url.searchParams.get("waypoints")).toBe("38.642175,-9.231557|38.696750,-9.214720|38.773890,-9.094167");
    // Separador de paradas codificado como %7C.
    expect(link).toContain("%7C");
  });

  it("divide em vários links encadeados quando passa do limite de paradas", () => {
    // Início + 20 paradas + volta = 22 pontos.
    const sequence = Array.from({ length: 22 }, (_, i) => point(i));
    const links = googleMapsLinks(sequence);
    expect(links).toHaveLength(3);
    const parts = links.map((link) => new URL(link).searchParams);
    for (const part of parts) {
      expect((part.get("waypoints") ?? "").split("|").filter(Boolean).length).toBeLessThanOrEqual(9);
    }
    // O destino de um link é a origem do próximo, e nada se perde.
    expect(parts[0].get("destination")).toBe(parts[1].get("origin"));
    expect(parts[1].get("destination")).toBe(parts[2].get("origin"));
    expect(parts[2].get("destination")).toBe("38.210000,-9.210000");
    const visited = parts.reduce((n, p) => n + 1 + (p.get("waypoints") ?? "").split("|").filter(Boolean).length, 1);
    expect(visited).toBe(22);
    for (const link of links) expect(link.length).toBeLessThanOrEqual(2048);
  });

  it("no celular o limite é de 3 paradas por link", () => {
    const sequence = Array.from({ length: 10 }, (_, i) => point(i));
    const links = googleMapsLinks(sequence, GOOGLE_WAYPOINTS_MOBILE);
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect((new URL(link).searchParams.get("waypoints") ?? "").split("|").filter(Boolean).length).toBeLessThanOrEqual(3);
    }
  });

  it("sem destino não há link; com dois pontos não há paradas", () => {
    expect(googleMapsLinks([P.B])).toEqual([]);
    const [link] = googleMapsLinks([P.B, P.Be]);
    expect(new URL(link).searchParams.has("waypoints")).toBe(false);
  });

  it("Waze: um destino por link", () => {
    expect(wazeLink(P.Be)).toBe("https://waze.com/ul?ll=38.696750,-9.214720&navigate=yes");
  });

  it("rota em texto", () => {
    const depart = new Date(2026, 10, 17, 9, 0);
    const loop = computePlan([P.B, P.CC, P.Be, P.PN, P.B], "depart", depart, mockLegTime);
    const text = routeText(P.B, loop, 3, true, ["https://exemplo/1"]);
    expect(text.split("\n")).toEqual([
      "Rota: 2 h 13 min (saída 09:00, chegada 11:13)",
      "A. Barreiro (saída 09:00)",
      "1. Costa da Caparica (chega 09:33)",
      "2. Belém (chega 09:58)",
      "3. Parque das Nações (chega 10:29)",
      "Volta: Barreiro (chega 11:13)",
      "",
      "Google Maps: https://exemplo/1",
    ]);

    const toEnd = computePlan([P.B, P.CC, P.Bf], "depart", depart, mockLegTime);
    const lines = routeText(P.B, toEnd, 1, false, ["a", "b"]).split("\n");
    expect(lines[3]).toMatch(/^B\. Benfica/);
    expect(lines.slice(-2)).toEqual(["Google Maps (parte 1 de 2): a", "Google Maps (parte 2 de 2): b"]);
  });
});
