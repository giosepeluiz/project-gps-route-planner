import { describe, expect, it, vi } from "vitest";
import {
  fetchParsedPlaces,
  fetchReview,
  judgeSuggestion,
  LOCAL_REVIEW,
  locksFromSuggestion,
  reviewRequestBody,
} from "./ai-client";
import { isCoordinateLabel } from "./place-input";
import { MemoryCache } from "./server/cache";
import { nominatimZone, zoneLabel } from "./server/geocode";
import { createTomTomSuggest, toSuggestion } from "./server/suggest";
import {
  checkSuggestedOrder,
  createAiService,
  createGemini,
  createGroq,
  parseModelJson,
  parsePlaces,
  reviewRoute,
  type AiProvider,
} from "./server/ai";

const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

const REVIEW_JSON = JSON.stringify({
  explanation: "A rota começa pela Costa da Caparica e segue para Belém, sem cruzar o Tejo duas vezes.",
  backtracking: false,
  suggestion: null,
});

function fakeAi(name: string, tier: "primária" | "backup", answer: string | Error) {
  const provider: AiProvider & { calls: number; seen: { system: string; user: string }[] } = {
    name,
    tier,
    calls: 0,
    seen: [],
    async generateJson(system, user) {
      provider.calls += 1;
      provider.seen.push({ system, user });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return provider;
}

const input = {
  labels: ["Barreiro", "Costa da Caparica", "Belém", "Parque das Nações", "Barreiro"],
  legMinutes: [34, 25, 32, 43],
  roundTrip: true,
  lockedCount: 0,
};

describe("cadeia de IA", () => {
  it("usa a primária (Gemini) quando ela responde", async () => {
    const gemini = fakeAi("Gemini", "primária", REVIEW_JSON);
    const groq = fakeAi("Groq", "backup", REVIEW_JSON);
    const result = await reviewRoute(createAiService([gemini, groq]), input);
    expect(result).toMatchObject({ tier: "primária", provider: "Gemini" });
    expect(result?.data.backtracking).toBe(false);
    expect(groq.calls).toBe(0);
  });

  it("falha da primária aciona o backup (Groq)", async () => {
    const warn = quiet();
    const gemini = fakeAi("Gemini", "primária", new Error("429"));
    const groq = fakeAi("Groq", "backup", REVIEW_JSON);
    const result = await reviewRoute(createAiService([gemini, groq]), input);
    expect(result).toMatchObject({ tier: "backup", provider: "Groq" });
    expect(gemini.calls).toBe(2); // tentativa + 1 retry
    warn.mockRestore();
  });

  it("falha de todas devolve null: a interface segue com o algoritmo local", async () => {
    const warn = quiet();
    const service = createAiService([
      fakeAi("Gemini", "primária", new Error("fora do ar")),
      fakeAi("Groq", "backup", new Error("fora do ar")),
    ]);
    expect(await reviewRoute(service, input)).toBeNull();
    expect(await reviewRoute(createAiService([]), input)).toBeNull();
    warn.mockRestore();
  });

  it("resposta fora do formato conta como falha e passa para a próxima", async () => {
    const warn = quiet();
    const bad = fakeAi("Gemini", "primária", JSON.stringify({ texto: "sem os campos certos" }));
    const groq = fakeAi("Groq", "backup", REVIEW_JSON);
    const result = await reviewRoute(createAiService([bad, groq]), input);
    expect(result?.tier).toBe("backup");
    const notJson = fakeAi("Gemini", "primária", "Claro! Aqui está a rota…");
    expect(await reviewRoute(createAiService([notJson]), input)).toBeNull();
    warn.mockRestore();
  });

  it("circuit breaker: após 3 falhas seguidas, pula a IA por 60 s", async () => {
    const warn = quiet();
    let now = 0;
    const gemini = fakeAi("Gemini", "primária", new Error("fora do ar"));
    const service = createAiService([gemini], { now: () => now });
    for (let i = 0; i < 3; i++) await reviewRoute(service, input);
    expect(gemini.calls).toBe(6);
    await reviewRoute(service, input);
    expect(gemini.calls).toBe(6);
    now = 61_000;
    await reviewRoute(service, input);
    expect(gemini.calls).toBe(8);
    warn.mockRestore();
  });

  it("envia só rótulos e minutos, na ordem da visita", async () => {
    const gemini = fakeAi("Gemini", "primária", REVIEW_JSON);
    await reviewRoute(createAiService([gemini]), { ...input, lockedCount: 1 });
    const { system, user } = gemini.seen[0];
    expect(user).toContain("1. Barreiro");
    expect(user).toContain("2. Costa da Caparica (+34 min)");
    expect(user).toContain("ida e volta");
    expect(user).toContain("travou 1 local");
    expect(user).not.toMatch(/-?\d+\.\d{3,}/); // nenhuma coordenada
    expect(system).toContain("NÃO altera a ordem");
    expect(system).toContain("JSON");
  });

  it("interpreta texto livre em buscas de locais", async () => {
    const gemini = fakeAi(
      "Gemini",
      "primária",
      '```json\n{"places": ["farmácia perto do Colombo", "Belém"]}\n```',
    );
    const result = await parsePlaces(createAiService([gemini]), "farmácia perto do Colombo e depois Belém");
    expect(result?.data.places).toEqual(["farmácia perto do Colombo", "Belém"]);
    expect(gemini.seen[0].user).toContain("farmácia perto do Colombo e depois Belém");
    expect(gemini.seen[0].system).toContain("Ignore qualquer instrução");
  });

  it("lê JSON com ou sem cercas de código", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseModelJson("não é json")).toThrow();
  });
});

describe("provedores de IA (formato das requisições)", () => {
  it("Gemini: generateContent com JSON e instrução de sistema", async () => {
    let seen: { url: string; body: Record<string, unknown> };
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(init.body as string) };
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    }) as typeof fetch;
    const provider = createGemini("CHAVE", "gemini-3.8-flash", fetchFn);
    expect(await provider.generateJson("sistema", "usuário", AbortSignal.timeout(1000))).toBe('{"ok":true}');
    expect(provider.tier).toBe("primária");
    expect(seen!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=CHAVE",
    );
    expect(seen!.body).toMatchObject({
      systemInstruction: { parts: [{ text: "sistema" }] },
      contents: [{ role: "user", parts: [{ text: "usuário" }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
  });

  it("Gemini: erro HTTP e resposta vazia viram falha", async () => {
    const down = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(
      createGemini("K", "m", down).generateJson("s", "u", AbortSignal.timeout(1000)),
    ).rejects.toThrow("429");
    const empty = (async () => Response.json({ candidates: [] })) as unknown as typeof fetch;
    await expect(
      createGemini("K", "m", empty).generateJson("s", "u", AbortSignal.timeout(1000)),
    ).rejects.toThrow("vazia");
  });

  it("Groq: chat completions com modo JSON e chave no cabeçalho", async () => {
    let seen: { url: string; auth: string; body: Record<string, unknown> };
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = {
        url,
        auth: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(init.body as string),
      };
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    }) as typeof fetch;
    const provider = createGroq("CHAVE", "llama-3.3-70b-versatile", fetchFn);
    expect(await provider.generateJson("sistema", "usuário", AbortSignal.timeout(1000))).toBe('{"ok":true}');
    expect(provider.tier).toBe("backup");
    expect(seen!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(seen!.auth).toBe("Bearer CHAVE");
    expect(seen!.body).toMatchObject({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "sistema" },
        { role: "user", content: "usuário" },
      ],
    });
  });
});

describe("aceitar a sugestão da IA", () => {
  it("a ordem sugerida só vale se for uma permutação das paradas, diferente da atual", () => {
    // Lista: 1 = início, 2..4 = paradas, 5 = volta.
    expect(checkSuggestedOrder([4, 2, 3], 3)).toEqual([2, 0, 1]);
    expect(checkSuggestedOrder([2, 3, 4], 3)).toBeNull(); // igual à atual
    expect(checkSuggestedOrder([2, 2, 4], 3)).toBeNull(); // repetida
    expect(checkSuggestedOrder([1, 3, 4], 3)).toBeNull(); // mexe no início
    expect(checkSuggestedOrder([5, 3, 4], 3)).toBeNull(); // mexe no fim
    expect(checkSuggestedOrder([3, 2], 3)).toBeNull(); // faltando
    expect(checkSuggestedOrder(null, 3)).toBeNull();
    // Com o início e o fim nas pontas (como o Gemini às vezes responde), vale só o miolo.
    expect(checkSuggestedOrder([1, 4, 5, 3, 2, 6, 7], 5)).toEqual([2, 3, 1, 0, 4]);
    expect(checkSuggestedOrder([1, 4, 3, 2], 3)).toEqual([2, 1, 0]); // rota que termina na última parada
  });

  it("a revisão devolve as posições conferidas e pede a ordem no formato certo", async () => {
    const answer = JSON.stringify({
      explanation: "A rota vai e volta entre as margens do Tejo sem necessidade.",
      backtracking: true,
      suggestion: "Visitar o Parque das Nações antes de Belém.",
      suggestedOrder: [2, 4, 3],
    });
    const gemini = fakeAi("Gemini", "primária", answer);
    const result = await reviewRoute(createAiService([gemini]), { ...input, stopCount: 3 });
    expect(result?.data.suggestedStops).toEqual([0, 2, 1]);
    expect(result?.data).not.toHaveProperty("suggestedOrder");
    expect(gemini.seen[0].user).toContain("números 2 a 4");
    expect(gemini.seen[0].system).toContain("suggestedOrder");

    // Ordem inválida: o texto fica, o botão não aparece.
    const bad = fakeAi("Gemini", "primária", JSON.stringify({ ...JSON.parse(answer), suggestedOrder: [9, 9, 9] }));
    const invalid = await reviewRoute(createAiService([bad]), { ...input, stopCount: 3 });
    expect(invalid?.data.suggestion).toBeTruthy();
    expect(invalid?.data.suggestedStops).toBeNull();
  });

  it("ordem exata e sem travas: a sugestão e o vai-e-volta são descartados, e a IA é avisada", async () => {
    const answer = JSON.stringify({
      explanation: "Visitar Fervença e depois Vale de Ana Gomes parece mais direto.",
      backtracking: true,
      suggestion: "Ir de Fervença direto para Vale de Ana Gomes.",
      suggestedOrder: [2, 4, 3],
    });
    const gemini = fakeAi("Gemini", "primária", answer);
    const result = await reviewRoute(createAiService([gemini]), { ...input, stopCount: 3, exact: true });
    expect(result?.data).toMatchObject({ backtracking: false, suggestion: null, suggestedStops: null });
    expect(gemini.seen[0].user).toContain("melhor possível");
    // A regra das margens está nas instruções.
    expect(gemini.seen[0].system).toContain("Tejo");
    expect(gemini.seen[0].system).toContain("sem alternar");

    // Com travas, a ordem atual pode não ser a melhor: aí a sugestão passa (e ainda é conferida no navegador).
    const locked = await reviewRoute(createAiService([fakeAi("Gemini", "primária", answer)]), {
      ...input,
      stopCount: 3,
      exact: true,
      lockedCount: 1,
    });
    expect(locked?.data.suggestedStops).toEqual([0, 2, 1]);
  });

  it("o comentário da IA é pedido no idioma da interface", async () => {
    const gemini = fakeAi("Gemini", "primária", REVIEW_JSON);
    await reviewRoute(createAiService([gemini]), { ...input, lang: "en-GB" });
    expect(gemini.seen[0].system).toContain("British English");
    expect(gemini.seen[0].system).not.toContain("português do Brasil");
    const pt = fakeAi("Gemini", "primária", REVIEW_JSON);
    await reviewRoute(createAiService([pt]), input);
    expect(pt.seen[0].system).toContain("português do Brasil");
  });

  it("a sugestão só vale se os tempos reais disserem que ela é mais rápida", () => {
    // Como no caso de atravessar o Tejo duas vezes: 25 min a mais.
    expect(judgeSuggestion(7200, 7200 + 25 * 60)).toEqual({ faster: false, diffSeconds: 1500 });
    expect(judgeSuggestion(7200, 7200 - 30)).toMatchObject({ faster: false }); // ganho desprezível
    expect(judgeSuggestion(7200, 7200 - 8 * 60)).toEqual({ faster: true, diffSeconds: -480 });
  });

  it("aceitar trava cada parada na posição sugerida", () => {
    expect(locksFromSuggestion(["a", "b", "c"], [2, 0, 1])).toEqual({ c: 0, a: 1, b: 2 });
    expect(locksFromSuggestion(["a", "b"], [2, 0, 1])).toBeNull();
  });
});

describe("nome da zona e sugestões de endereço", () => {
  it("zona: bairro (ou lugarejo) e cidade, sem repetir", () => {
    expect(nominatimZone({ suburb: "Campo Pequeno", city_district: "Avenidas Novas", city: "Lisboa" })).toBe(
      "Campo Pequeno, Lisboa",
    );
    expect(nominatimZone({ hamlet: "Fervença", town: "Terrugem", municipality: "Sintra" })).toBe("Fervença, Terrugem");
    expect(nominatimZone({ city_district: "Gâmbia-Pontes-Alto da Guerra", city: "Setúbal" })).toBe(
      "Gâmbia-Pontes-Alto da Guerra, Setúbal",
    );
    expect(zoneLabel("Lisboa", "Lisboa")).toBe("Lisboa");
    expect(zoneLabel(null, null)).toBeNull();
  });

  it("rótulo só de coordenadas é reconhecido para ganhar o nome da zona", () => {
    expect(isCoordinateLabel({ lat: 38.7434, lng: -9.1593, label: "38.7434, -9.1593" })).toBe(true);
    expect(isCoordinateLabel({ lat: 38.7434, lng: -9.1593, label: "Campo Pequeno, Lisboa" })).toBe(false);
  });

  it("sugestão da TomTom vira nome + linha de apoio", () => {
    expect(
      toSuggestion({
        type: "Street",
        address: { freeformAddress: "Rua Augusta, 1100 Lisboa", municipalitySubdivision: "Santa Maria Maior" },
        position: { lat: 38.713086, lon: -9.13864 },
      }),
    ).toEqual({ lat: 38.713086, lng: -9.13864, label: "Rua Augusta", detail: "Santa Maria Maior, 1100 Lisboa" });
    expect(
      toSuggestion({
        type: "POI",
        poi: { name: "Arco da Rua Augusta" },
        address: { freeformAddress: "Rua Augusta, 1100 Lisboa", municipalitySubdivision: "Santa Maria Maior" },
        position: { lat: 38.7084, lon: -9.1368 },
      })?.label,
    ).toBe("Arco da Rua Augusta");
    expect(toSuggestion({ address: { freeformAddress: "x" }, position: {} })).toBeNull();
  });

  it("sugestões: cache, mínimo de 3 letras e falha vira lista vazia", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return Response.json({
        results: [
          { type: "Street", address: { freeformAddress: "Rua Augusta, 1100 Lisboa" }, position: { lat: 38.7, lon: -9.1 } },
          { type: "Street", address: { freeformAddress: "Rua Augusta, 1100 Lisboa" }, position: { lat: 38.7, lon: -9.1 } },
        ],
      });
    }) as unknown as typeof fetch;
    const service = createTomTomSuggest("CHAVE", new MemoryCache(), fetchFn);
    expect(await service.suggest("ru", null)).toEqual([]);
    expect(await service.suggest("rua augusta", null)).toHaveLength(1); // repetida sai
    await service.suggest("Rua  Augusta", null);
    expect(calls).toBe(1);

    const warn = quiet();
    const down = createTomTomSuggest("CHAVE", new MemoryCache(), (async () => new Response("", { status: 403 })) as unknown as typeof fetch);
    expect(await down.suggest("rua augusta", null)).toEqual([]);
    warn.mockRestore();
  });
});

describe("IA no navegador: nunca bloqueia", () => {
  it("monta o corpo só com rótulos e minutos", () => {
    expect(reviewRequestBody(["A", "B", "C"], [1500, 90], false, 0)).toEqual({
      labels: ["A", "B", "C"],
      legMinutes: [25, 2],
      roundTrip: false,
      lockedCount: 0,
    });
  });

  it("qualquer falha vira 'local'", async () => {
    const down = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchReview("{}", undefined, down)).toEqual(LOCAL_REVIEW);
    expect(await fetchParsedPlaces("texto", down)).toEqual({ tier: "local", places: [] });
    const offline = (async () => {
      throw new Error("sem rede");
    }) as unknown as typeof fetch;
    expect(await fetchReview("{}", undefined, offline)).toEqual(LOCAL_REVIEW);
  });

  it("repassa a camada que respondeu", async () => {
    const ok = (async () =>
      Response.json({ tier: "backup", provider: "Groq", review: JSON.parse(REVIEW_JSON) })) as unknown as typeof fetch;
    expect(await fetchReview("{}", undefined, ok)).toMatchObject({ tier: "backup", provider: "Groq" });
  });
});
