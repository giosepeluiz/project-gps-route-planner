import { describe, expect, it } from "vitest";
import { GOOGLE_WAYPOINTS_MOBILE, googleMapsLinks, routeText, wazeLink } from "./export";
import { FIXTURE_PLACES as P, mockLegTime } from "./mock-data";
import { computePlan } from "./plan";
import {
  BLOCK_IDS,
  DEFAULT_SETTINGS,
  FONT_PX,
  moveItem,
  normalizeSettings,
  resolveTheme,
  SETTINGS_BOOT_SCRIPT,
} from "./settings";

describe("configurações", () => {
  it("valores inválidos ou ausentes caem no padrão", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("lixo")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: "roxo", fontSize: 99, panelSide: "cima", summaryDock: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("mantém as escolhas válidas", () => {
    const saved = { theme: "dark", fontSize: "xl", panelSide: "left", summaryDock: "panel" };
    expect(normalizeSettings(saved)).toMatchObject(saved);
  });

  it("ordem dos blocos: tira repetidos e desconhecidos e completa os que faltam", () => {
    const { blockOrder } = normalizeSettings({ blockOrder: ["resumo", "xpto", "resumo", "inicio"] });
    expect(blockOrder.slice(0, 2)).toEqual(["resumo", "inicio"]);
    expect([...blockOrder].sort()).toEqual([...BLOCK_IDS].sort());
    expect(new Set(blockOrder).size).toBe(BLOCK_IDS.length);
  });

  it("tema do sistema segue a preferência do aparelho", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("move um bloco na lista", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["a", "b", "c"]);
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
    const saved = run(JSON.stringify({ theme: "light", fontSize: "xl" }), true);
    expect(saved.dataset.theme).toBe("light");
    expect(saved.style.fontSize).toBe(`${FONT_PX.xl}px`);
    // Armazenamento corrompido não quebra a página.
    expect(run("{não é json", true).dataset.theme).toBe("dark");
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
