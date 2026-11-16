import { describe, expect, it, vi } from "vitest";
import { classifyInput, resolvePlaceInput } from "./place-input";
import { parseInput } from "./map-urls";
import { LayeredCache, MemoryCache, type Cache } from "./server/cache";
import {
  createGeocoder,
  createNominatim,
  createTomTom,
  normalizeQuery,
  shortLabel,
  type GeocodeProvider,
} from "./server/geocode";
import { CircuitBreaker, CircuitOpenError, RateQueue, withPolicy } from "./server/resilience";
import { canFetch, createResolver, fromHtml } from "./server/resolve";

const near = (input: string, lat: number, lng: number) => {
  const c = parseInput(input);
  expect(c, input).not.toBeNull();
  expect(c!.lat, input).toBeCloseTo(lat, 4);
  expect(c!.lng, input).toBeCloseTo(lng, 4);
};

describe("formatos de entrada da seção 5 (sem rede)", () => {
  it("coordenadas: decimal, hemisférios, vírgula decimal, DMS e DDM", () => {
    near("38.7074, -9.1373", 38.7074, -9.1373);
    near("38,7074 -9,1373", 38.7074, -9.1373);
    near("38.7074 N, 9.1373 W", 38.7074, -9.1373);
    near("38.7074 N, 9.1373 O", 38.7074, -9.1373);
    near("23.5 S, 46.6 L", -23.5, 46.6);
    near(`38°42'26.6"N 9°08'14.3"W`, 38.70739, -9.13731);
    near("38°42.444'N 9°8.238'W", 38.7074, -9.1373);
  });

  it("Google Maps", () => {
    near("https://www.google.com/maps?q=38.7074,-9.1373", 38.7074, -9.1373);
    near("https://www.google.com/maps/@38.7074,-9.1373,15z", 38.7074, -9.1373);
    near("https://www.google.com/maps/place/38.7074,-9.1373", 38.7074, -9.1373);
    near("https://www.google.com/maps/search/38.7074,-9.1373", 38.7074, -9.1373);
    // Em /dir/ vale o destino (último ponto).
    near("https://www.google.com/maps/dir/38.7074,-9.1373/38.6967,-9.2147", 38.6967, -9.2147);
    near("https://www.google.com/maps/search/?api=1&query=38.7074,-9.1373", 38.7074, -9.1373);
    near("https://www.google.com.br/maps?q=38.7074,-9.1373", 38.7074, -9.1373);
    near("https://www.google.pt/maps/@38.7074,-9.1373,15z", 38.7074, -9.1373);
    // O marcador !3d…!4d… tem prioridade sobre o centro da tela (@).
    near(
      "https://www.google.com/maps/place/X/@38.70,-9.10,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d38.7074!4d-9.1373",
      38.7074,
      -9.1373,
    );
  });

  it("Waze", () => {
    near("https://waze.com/ul?ll=38.7074,-9.1373&navigate=yes", 38.7074, -9.1373);
    near("https://www.waze.com/live-map/directions?to=ll.38.7074%2C-9.1373", 38.7074, -9.1373);
    near("https://ul.waze.com/ul?ll=38.7074,-9.1373", 38.7074, -9.1373);
    near("waze://?ll=38.7074,-9.1373&navigate=yes", 38.7074, -9.1373);
    // waze.com/ul/h<geohash>
    const short = parseInput("https://waze.com/ul/heyckrdj1k5");
    expect(short).not.toBeNull();
    expect(Math.abs(short!.lat - 38.7)).toBeLessThan(0.2);
  });

  it("Apple Maps", () => {
    near("https://maps.apple.com/?ll=38.7074,-9.1373", 38.7074, -9.1373);
    near("https://maps.apple.com/?q=38.7074,-9.1373", 38.7074, -9.1373);
    near("https://maps.apple.com/?daddr=38.7074,-9.1373", 38.7074, -9.1373);
    near("https://maps.apple.com/place?coordinate=38.7074,-9.1373", 38.7074, -9.1373);
    near("maps://?ll=38.7074,-9.1373", 38.7074, -9.1373);
  });

  it("TomTom, HERE, Yandex e Organic Maps", () => {
    near("tomtomgo://x-callback-url/navigate?destination=38.7074,-9.1373", 38.7074, -9.1373);
    near("tomtomhome:geo:action=show&lat=38.7074&long=-9.1373", 38.7074, -9.1373);
    near("https://share.here.com/l/38.7074,-9.1373", 38.7074, -9.1373);
    near("https://share.here.com/r/38.7074,-9.1373/38.6967,-9.2147", 38.7074, -9.1373);
    near("https://wego.here.com/?map=38.7074,-9.1373,15,normal", 38.7074, -9.1373);
    // Yandex escreve longitude primeiro em ?pt=
    near("https://yandex.com/maps/?pt=-9.1373,38.7074&z=15", 38.7074, -9.1373);
    near("https://maps.yandex.ru/?pt=-9.1373,38.7074", 38.7074, -9.1373);
    near("https://yandex.com/maps/?rtext=38.7074,-9.1373~38.6967,-9.2147", 38.7074, -9.1373);
    near("yandexmaps://maps.yandex.ru/?pt=-9.1373,38.7074", 38.7074, -9.1373);
    near("https://omaps.app/38.7074,-9.1373/Praça", 38.7074, -9.1373);
    // Códigos curtos do Organic Maps não decodificam.
    expect(parseInput("https://omaps.app/o4B4pYZsRs")).toBeNull();
    expect(parseInput("https://ge0.me/o4B4pYZsRs")).toBeNull();
  });

  it("geo:, OpenStreetMap, Bing e o próprio conversor", () => {
    near("geo:38.7074,-9.1373", 38.7074, -9.1373);
    expect(parseInput("geo:0,0?q=Praça do Comércio")).toBeNull();
    near("https://www.openstreetmap.org/#map=15/38.7074/-9.1373", 38.7074, -9.1373);
    near("https://www.openstreetmap.org/?mlat=38.7074&mlon=-9.1373", 38.7074, -9.1373);
    near("https://www.bing.com/maps?cp=38.7074~-9.1373&lvl=15", 38.7074, -9.1373);
    near("https://www.bing.com/maps?sp=point.38.7074_-9.1373_Nome", 38.7074, -9.1373);
    near("https://coordenadas.arqueirover.de/?c=38.7074,-9.1373", 38.7074, -9.1373);
    near("https://coordenadas.arqueirover.de/38.7074,-9.1373", 38.7074, -9.1373);
    near("https://coordenadas.arqueirover.de/c/38.7074,-9.1373", 38.7074, -9.1373);
    near("https://coordenadas.arqueirover.de/coord/38.7074,-9.1373", 38.7074, -9.1373);
    near("https://coordenadas.arqueirover.de/https://maps.google.com/?q=38.7074,-9.1373", 38.7074, -9.1373);
  });

  it("texto de compartilhamento com link dentro", () => {
    near("Praça do Comércio https://www.google.com/maps?q=38.7074,-9.1373", 38.7074, -9.1373);
  });
});

describe("classificação do texto digitado", () => {
  it("separa coordenadas, links e endereços", () => {
    expect(classifyInput("38.7074, -9.1373")).toMatchObject({ kind: "coords", source: "coords" });
    expect(classifyInput("https://waze.com/ul?ll=38.7074,-9.1373")).toMatchObject({
      kind: "coords",
      source: "link",
    });
    expect(classifyInput("https://maps.app.goo.gl/abc123")).toEqual({
      kind: "link",
      text: "https://maps.app.goo.gl/abc123",
    });
    expect(classifyInput("Olha: https://maps.app.goo.gl/abc123")).toMatchObject({ kind: "link" });
    expect(classifyInput("Rua Augusta 100, Lisboa")).toEqual({
      kind: "address",
      query: "Rua Augusta 100, Lisboa",
    });
    // Parece domínio, mas não é link de mapa: vai para a busca por endereço.
    expect(classifyInput("Av.Liberdade")).toMatchObject({ kind: "address" });
  });

  it("chama a API certa e monta o local", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      if (url.startsWith("/api/resolve")) return Response.json({ lat: 1, lng: 2, label: "Lugar" });
      if (url.startsWith("/api/geocode"))
        return Response.json({ lat: 3, lng: 4, label: "Rua X", confidence: 0.7, provider: "nominatim" });
      return new Response("", { status: 404 });
    }) as typeof fetch;

    expect(await resolvePlaceInput("38.5, -9.1", null, fetchFn)).toMatchObject({ source: "coords", lat: 38.5 });
    expect(calls).toHaveLength(0);

    expect(await resolvePlaceInput("https://maps.app.goo.gl/abc", null, fetchFn)).toMatchObject({
      source: "link",
      label: "Lugar",
    });
    expect(await resolvePlaceInput("Rua X", [-9.3, 38.6, -9, 38.8], fetchFn)).toMatchObject({
      source: "address",
      label: "Rua X",
      confidence: 0.7,
    });
    expect(calls[1]).toContain("bbox=-9.3000%2C38.6000%2C-9.0000%2C38.8000");
  });

  it("devolve null quando o servidor não encontra", async () => {
    const fetchFn = (async () => Response.json({ error: "x" }, { status: 422 })) as typeof fetch;
    expect(await resolvePlaceInput("Lugar que não existe", null, fetchFn)).toBeNull();
  });
});

describe("cache", () => {
  it("expira por TTL e descarta o menos usado (LRU)", async () => {
    let now = 0;
    const cache = new MemoryCache(2, () => now);
    await cache.set("a", 1, 10);
    await cache.set("b", 2, 10);
    expect(await cache.get("a")).toBe(1); // "a" vira o mais recente
    await cache.set("c", 3, 10);
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("a")).toBe(1);
    now = 11_000;
    expect(await cache.get("a")).toBeNull();
  });

  it("falha do cache remoto não derruba a leitura nem a escrita", async () => {
    const broken: Cache = {
      get: async () => {
        throw new Error("fora do ar");
      },
      set: async () => {
        throw new Error("fora do ar");
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new LayeredCache(new MemoryCache(), broken);
    expect(await cache.get("x")).toBeNull();
    await cache.set("x", 1, 10);
    expect(await cache.get("x")).toBe(1);
    warn.mockRestore();
  });
});

describe("resiliência", () => {
  it("faz 1 retry e conta uma falha só por chamada", async () => {
    const breaker = new CircuitBreaker("p");
    let calls = 0;
    const result = await withPolicy(breaker, async () => {
      calls += 1;
      if (calls === 1) throw new Error("falhou");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("abre o circuito após 3 falhas seguidas e fecha depois de 60 s", async () => {
    let now = 0;
    const breaker = new CircuitBreaker("p", 3, 60_000, () => now);
    const fail = () => withPolicy(breaker, async () => Promise.reject(new Error("x")), { retries: 0 });
    for (let i = 0; i < 3; i++) await expect(fail()).rejects.toThrow("x");
    await expect(fail()).rejects.toBeInstanceOf(CircuitOpenError);
    now = 60_001;
    expect(await withPolicy(breaker, async () => "voltou")).toBe("voltou");
  });

  it("a fila respeita o intervalo mínimo entre chamadas", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const queue = new RateQueue(
      1100,
      () => now,
      async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    );
    now = 5000;
    await Promise.all([queue.run(async () => 1), queue.run(async () => 2), queue.run(async () => 3)]);
    expect(sleeps).toEqual([1100, 1100]);
  });
});

const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

function fakeProvider(name: string, behavior: "ok" | "empty" | "error"): GeocodeProvider & { calls: number } {
  const provider = {
    name,
    calls: 0,
    async search(query: string) {
      provider.calls += 1;
      if (behavior === "error") throw new Error(`${name} fora do ar`);
      if (behavior === "empty") return null;
      return { lat: 38.7, lng: -9.1, label: query, confidence: 0.8, provider: name };
    },
    async reverse() {
      provider.calls += 1;
      if (behavior === "error") throw new Error(`${name} fora do ar`);
      return behavior === "empty" ? null : `Endereço via ${name}`;
    },
  };
  return provider;
}

describe("cadeia de geocodificação", () => {
  it("usa o primário quando ele responde", async () => {
    const a = fakeProvider("nominatim", "ok");
    const b = fakeProvider("tomtom", "ok");
    const geocoder = createGeocoder({ providers: [a, b], cache: new MemoryCache() });
    expect((await geocoder.search("Rua Augusta, Lisboa"))?.provider).toBe("nominatim");
    expect(b.calls).toBe(0);
  });

  it("falha do primário aciona o backup", async () => {
    const warn = quiet();
    const a = fakeProvider("nominatim", "error");
    const b = fakeProvider("tomtom", "ok");
    const geocoder = createGeocoder({ providers: [a, b], cache: new MemoryCache() });
    expect((await geocoder.search("Rua Augusta, Lisboa"))?.provider).toBe("tomtom");
    expect(a.calls).toBe(2); // tentativa + 1 retry
    expect((await geocoder.reverse({ lat: 38.7, lng: -9.1 }))?.provider).toBe("tomtom");
    warn.mockRestore();
  });

  it("primário sem resultado também passa para o backup", async () => {
    const geocoder = createGeocoder({
      providers: [fakeProvider("nominatim", "empty"), fakeProvider("tomtom", "ok")],
      cache: new MemoryCache(),
    });
    expect((await geocoder.search("Lugar raro"))?.provider).toBe("tomtom");
  });

  it("falha de todos devolve null", async () => {
    const warn = quiet();
    const geocoder = createGeocoder({
      providers: [fakeProvider("nominatim", "error"), fakeProvider("tomtom", "error")],
      cache: new MemoryCache(),
    });
    expect(await geocoder.search("Rua Augusta, Lisboa")).toBeNull();
    expect(await geocoder.reverse({ lat: 38.7, lng: -9.1 })).toBeNull();
    warn.mockRestore();
  });

  it("guarda o resultado em cache", async () => {
    const a = fakeProvider("nominatim", "ok");
    const geocoder = createGeocoder({ providers: [a], cache: new MemoryCache() });
    await geocoder.search("Rua  Augusta,   Lisboa");
    await geocoder.search("rua augusta, lisboa");
    expect(a.calls).toBe(1);
  });

  it("normaliza o texto e encurta rótulos", () => {
    expect(normalizeQuery("  Av.  da Liberdade ,Lisboa ")).toBe("Avenida da Liberdade ,Lisboa");
    expect(shortLabel("Praça do Comércio, Baixa, Lisboa, Portugal", "Praça do Comércio")).toBe(
      "Praça do Comércio, Baixa",
    );
    expect(shortLabel("Rua Augusta, Lisboa, Portugal")).toBe("Rua Augusta, Lisboa");
  });

  it("Nominatim: monta a URL com viewbox e User-Agent", async () => {
    const seen: { url: string; ua: string }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, ua: (init.headers as Record<string, string>)["User-Agent"] });
      return Response.json([{ lat: "38.7", lon: "-9.1", name: "Sé", display_name: "Sé, Lisboa", importance: 0.6 }]);
    }) as typeof fetch;
    const provider = createNominatim("rotas-teste/1.0", fetchFn, new RateQueue(0));
    const found = await provider.search(
      "Sé de Lisboa",
      { west: -9.3, south: 38.6, east: -9, north: 38.8 },
      AbortSignal.timeout(1000),
    );
    expect(found).toMatchObject({ lat: 38.7, lng: -9.1, label: "Sé, Lisboa", provider: "nominatim" });
    expect(seen[0].ua).toBe("rotas-teste/1.0");
    expect(seen[0].url).toContain("nominatim.openstreetmap.org/search?");
    expect(seen[0].url).toContain("viewbox=-9.3%2C38.8%2C-9%2C38.6");
    expect(seen[0].url).not.toContain("bounded");
  });

  it("TomTom: lê position e matchConfidence", async () => {
    let seenUrl = "";
    const fetchFn = (async (url: string) => {
      seenUrl = url;
      return Response.json({
        results: [
          {
            position: { lat: 38.7, lon: -9.1 },
            address: { freeformAddress: "Rua Augusta, 1100 Lisboa" },
            matchConfidence: { score: 0.9 },
          },
        ],
      });
    }) as typeof fetch;
    const provider = createTomTom("CHAVE", fetchFn);
    const found = await provider.search("Rua Augusta", null, AbortSignal.timeout(1000));
    expect(found).toMatchObject({ lat: 38.7, lng: -9.1, confidence: 0.9, provider: "tomtom" });
    expect(seenUrl).toContain("https://api.tomtom.com/search/2/geocode/Rua%20Augusta.json?");
  });
});

describe("resolução de links no servidor", () => {
  it("allowlist: só HTTPS de serviços de mapas conhecidos", () => {
    const ok = (u: string) => canFetch(new URL(u));
    expect(ok("https://maps.app.goo.gl/abc")).toBe(true);
    expect(ok("https://www.google.com/maps/place/X")).toBe(true);
    expect(ok("https://waze.com/ul/hxyz")).toBe(true);
    expect(ok("https://maps.apple/p/abc")).toBe(true);
    expect(ok("http://maps.app.goo.gl/abc")).toBe(false);
    expect(ok("https://example.com/maps")).toBe(false);
    expect(ok("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(ok("https://localhost/maps")).toBe(false);
    expect(ok("https://maps.app.goo.gl.evil.com/abc")).toBe(false);
    expect(ok("https://user:pass@maps.app.goo.gl/abc")).toBe(false);
    expect(ok("https://maps.app.goo.gl:8443/abc")).toBe(false);
  });

  const deps = (fetchFn: typeof fetch, providers: GeocodeProvider[] = []) => {
    const cache = new MemoryCache();
    return createResolver({ geocoder: createGeocoder({ providers, cache }), cache, fetchFn });
  };

  it("segue o link curto até a URL com coordenadas", async () => {
    const hops: string[] = [];
    const fetchFn = (async (url: URL) => {
      hops.push(url.href);
      return new Response(null, {
        status: 302,
        headers: { location: "https://www.google.com/maps/place/Sé/@38.70,-9.13,17z/data=!3d38.7098!4d-9.1326" },
      });
    }) as unknown as typeof fetch;
    const resolve = deps(fetchFn);
    const found = await resolve("https://maps.app.goo.gl/abc123");
    expect(found?.lat).toBeCloseTo(38.7098, 4);
    expect(found?.lng).toBeCloseTo(-9.1326, 4);
    expect(hops).toEqual(["https://maps.app.goo.gl/abc123"]);
    // Segunda vez vem do cache.
    await resolve("https://maps.app.goo.gl/abc123");
    expect(hops).toHaveLength(1);
  });

  it("não segue redirecionamento para fora da allowlist", async () => {
    const hops: string[] = [];
    const fetchFn = (async (url: URL) => {
      hops.push(url.href);
      return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/segredo" } });
    }) as unknown as typeof fetch;
    expect(await deps(fetchFn)("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(hops).toEqual(["https://maps.app.goo.gl/abc123"]);
  });

  it("para depois do limite de redirecionamentos", async () => {
    let count = 0;
    const fetchFn = (async () => {
      count += 1;
      return new Response(null, { status: 302, headers: { location: `https://maps.app.goo.gl/loop${count}` } });
    }) as unknown as typeof fetch;
    expect(await deps(fetchFn)("https://maps.app.goo.gl/loop0")).toBeNull();
    expect(count).toBe(6);
  });

  it("não acessa a rede para links que não são de mapas", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    expect(await deps(fetchFn)("https://example.com/qualquer")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("lugar por nome cai na geocodificação", async () => {
    const fetchFn = (async () =>
      new Response("<html></html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const resolve = deps(fetchFn, [fakeProvider("nominatim", "ok")]);
    const found = await resolve("https://www.google.com/maps/place/Torre+de+Belém");
    expect(found).toMatchObject({ lat: 38.7, lng: -9.1 });
  });

  it("lê coordenadas do HTML (Apple Maps e marcador do Google)", () => {
    expect(
      fromHtml(
        `<meta property="place:location:latitude" content="38.7"><meta property="place:location:longitude" content="-9.1">`,
      ),
    ).toEqual({ lat: 38.7, lng: -9.1 });
    expect(fromHtml("...!3d38.7098!4d-9.1326...")).toEqual({ lat: 38.7098, lng: -9.1326 });
    expect(fromHtml("<html>nada</html>")).toBeNull();
  });
});
