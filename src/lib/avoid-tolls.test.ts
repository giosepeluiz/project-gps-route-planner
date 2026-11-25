import { describe, expect, it } from "vitest";
import { googleMapsLinks, navigationLinks } from "./export";
import { planRequestBody } from "./plan-client";
import { placesSignature } from "./plan-memory";
import { MemoryCache } from "./server/cache";
import { createMatrixService, type MatrixOptions, type MatrixProvider } from "./server/matrix";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

const A = { id: "A", lat: 38.7, lng: -9.1 };
const B = { id: "B", lat: 38.8, lng: -9.2 };

const block = { seconds: [[0, 60], [60, 0]], meters: [[0, 1000], [1000, 0]] };

function provider(name: string, avoidTolls: boolean, seen: (MatrixOptions | undefined)[]): MatrixProvider {
  return {
    name,
    trafficAware: true,
    label: name,
    avoidTolls,
    async getCells(_o, _d, _t, _s, options) {
      seen.push(options);
      return block;
    },
  };
}

describe("evitar pedágios", () => {
  it("vem desligado por padrão e só liga com true", () => {
    expect(DEFAULT_SETTINGS.avoidTolls).toBe(false);
    expect(normalizeSettings({}).avoidTolls).toBe(false);
    expect(normalizeSettings({ avoidTolls: "sim" }).avoidTolls).toBe(false);
    expect(normalizeSettings({ avoidTolls: true }).avoidTolls).toBe(true);
  });

  it("o pedido ao servidor só leva avoidTolls quando ligado", () => {
    const base = { start: A, stops: [B], end: null, endSame: false, locks: {}, mode: "depart" as const, dateTime: null };
    const place = (p: typeof A) => ({ ...p, label: p.id }) as never;
    const off = planRequestBody({ ...base, start: place(A), stops: [place(B)] });
    const on = planRequestBody({ ...base, start: place(A), stops: [place(B)], avoidTolls: true });
    expect("avoidTolls" in off).toBe(false);
    expect(on.avoidTolls).toBe(true);
    // A memória do último plano não mistura tempos com e sem pedágio.
    expect(placesSignature(JSON.stringify(off))).not.toBe(placesSignature(JSON.stringify(on)));
  });

  it("os links do Google Maps pedem avoid=tolls só quando ligado", () => {
    const seq = [A, B];
    expect(googleMapsLinks(seq)[0]).not.toContain("avoid=");
    expect(googleMapsLinks(seq, 9, true)[0]).toContain("avoid=tolls");
    const google = navigationLinks(B, true).find((app) => app.id === "google")!;
    expect(new URL(google.href).searchParams.get("avoid")).toBe("tolls");
    expect(new URL(navigationLinks(B).find((app) => app.id === "google")!.href).searchParams.has("avoid")).toBe(false);
  });

  it("a matriz pula quem não sabe evitar pedágio e repassa o pedido a quem sabe", async () => {
    const seenA: (MatrixOptions | undefined)[] = [];
    const seenB: (MatrixOptions | undefined)[] = [];
    const service = createMatrixService({
      providers: [provider("sem", false, seenA), provider("com", true, seenB)],
      cache: new MemoryCache(),
    });
    const free = await service.getMatrix([A, B], new Date(), { avoidTolls: true });
    expect(free.source).toBe("com");
    expect(seenA).toHaveLength(0);
    expect(seenB[0]).toEqual({ avoidTolls: true });
    // Sem a opção, o primeiro da cadeia responde, como sempre.
    const normal = await service.getMatrix([A, B], new Date());
    expect(normal.source).toBe("sem");
  });

  it("sem nenhum provedor que evite pedágio, cai na estimativa", async () => {
    const service = createMatrixService({ providers: [provider("sem", false, [])], cache: new MemoryCache() });
    const result = await service.getMatrix([A, B], new Date(), { avoidTolls: true });
    expect(result.estimated).toBe(true);
  });
});
