/** Instâncias únicas (por processo) dos serviços do servidor, montadas pelas variáveis de ambiente. */
import { createAiService, createGemini, createGroq, type AiProvider, type AiService } from "./ai";
import { createCache, type Cache } from "./cache";
import { createGeocoder, createNominatim, createTomTom, type GeocodeProvider, type Geocoder } from "./geocode";
import {
  createGoogleMatrix,
  createHereMatrix,
  createMatrixService,
  createOrsMatrix,
  createTomTomMatrix,
  createTomTomPairwise,
  type MatrixProvider,
  type MatrixService,
} from "./matrix";
import { apiLimitPerMinute } from "./rate-limit";
import { budgetLimits, createBudget, type Budget, type BudgetKey } from "./usage";
import { createResolver } from "./resolve";
import { createTomTomSuggest, noSuggest, type SuggestService } from "./suggest";
import {
  chainGeometry,
  createGoogleGeometry,
  createOsrmDemoGeometry,
  createTomTomGeometry,
  type GeometryService,
} from "./route-geometry";

interface Services {
  cache: Cache;
  budget: Budget;
  geocoder: Geocoder;
  resolveInput: ReturnType<typeof createResolver>;
  matrix: MatrixService;
  geometry: GeometryService;
  ai: AiService;
  suggest: SuggestService;
}

let services: Services | null = null;

/** O que está ligado neste servidor, para a tela Sobre. Nunca inclui as chaves. */
export interface ServiceStatus {
  tomtom: boolean;
  here: boolean;
  google: boolean;
  openRouteService: boolean;
  osrmDemo: boolean;
  gemini: { enabled: boolean; model: string };
  groq: { enabled: boolean; model: string };
  sharedCache: boolean;
  mapFallback: boolean;
  rateLimitPerMinute: number;
  /** Envio das estatísticas anônimas da viagem por e-mail. */
  tripReport: boolean;
  /** Uso mensal de cada serviço com cota (preenchido pela rota /api/status). */
  usage?: Partial<Record<BudgetKey, { used: number; limit: number }>>;
}

export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
export const groqModel = () => process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

export function serviceStatus(): ServiceStatus {
  const has = (name: string) => !!process.env[name]?.trim();
  return {
    tomtom: has("TOMTOM_API_KEY"),
    here: has("HERE_API_KEY") && process.env.HERE_ENABLED?.trim() === "1",
    google: has("GOOGLE_MAPS_API_KEY"),
    openRouteService: has("ORS_API_KEY"),
    osrmDemo: process.env.NODE_ENV === "development",
    gemini: { enabled: has("GEMINI_API_KEY"), model: geminiModel() },
    groq: { enabled: has("GROQ_API_KEY"), model: groqModel() },
    sharedCache: has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN"),
    mapFallback: has("MAP_FALLBACK_STYLE_URL") || has("MAPTILER_KEY"),
    rateLimitPerMinute: apiLimitPerMinute(),
    tripReport: has("RESEND_API_KEY") && has("REPORT_EMAIL_FROM"),
  };
}

export function getServices(): Services {
  if (services) return services;

  const cache = createCache();
  // Trava de cota: nenhum serviço passa do limite mensal (10% abaixo da cota grátis, por padrão).
  const budget = createBudget({ cache, limits: budgetLimits() });
  const tomtomKey = process.env.TOMTOM_API_KEY?.trim();
  const orsKey = process.env.ORS_API_KEY?.trim();
  const hereKey = process.env.HERE_API_KEY?.trim();
  const googleKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  const geocoders: GeocodeProvider[] = [
    createNominatim(process.env.NOMINATIM_USER_AGENT?.trim() || "rotas-pessoal/1.0"),
  ];
  if (tomtomKey) geocoders.push(createTomTom(tomtomKey));
  const geocoder = createGeocoder({ providers: geocoders, cache });

  // Google matriz (principal, com trânsito) → TomTom matriz → TomTom rota a rota (com trânsito) →
  // OpenRouteService (sem trânsito) → estimativa (sempre presente). Quando a cota de um acaba, passa
  // para o seguinte. A HERE está desligada: só entra com HERE_ENABLED=1 (e HERE_API_KEY), depois da TomTom.
  const matrixProviders: MatrixProvider[] = [];
  const hereUnit = process.env.HERE_COUNT?.trim() === "request" ? "request" : "element";
  const hereOn = process.env.HERE_ENABLED?.trim() === "1";
  if (googleKey) matrixProviders.push(createGoogleMatrix(googleKey, fetch, Date.now, budget));
  if (tomtomKey) matrixProviders.push(createTomTomMatrix(tomtomKey, fetch, Date.now, 100, budget));
  if (hereKey && hereOn) matrixProviders.push(createHereMatrix(hereKey, fetch, Date.now, budget, hereUnit));
  if (tomtomKey) matrixProviders.push(createTomTomPairwise(tomtomKey, fetch, Date.now, undefined, undefined, budget));
  if (orsKey) matrixProviders.push(createOrsMatrix(orsKey));

  // Rota pelas ruas: Google (principal), depois TomTom. Sem chaves, e só em desenvolvimento, o OSRM demo.
  const geometries: GeometryService[] = [];
  if (googleKey) geometries.push(createGoogleGeometry(googleKey, cache, fetch, Date.now, budget));
  if (tomtomKey) geometries.push(createTomTomGeometry(tomtomKey, cache, fetch, Date.now, budget));
  if (process.env.NODE_ENV === "development") geometries.push(createOsrmDemoGeometry(cache));

  // IA: Gemini Flash-Lite (primária) → Groq (backup). Sem chaves, a lista fica vazia
  // e a interface mostra "Algoritmo local". Os modelos mudam com frequência: por isso
  // são configuráveis por variável de ambiente.
  const aiProviders: AiProvider[] = [];
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (geminiKey) aiProviders.push(createGemini(geminiKey, geminiModel()));
  if (groqKey) aiProviders.push(createGroq(groqKey, groqModel()));

  services = {
    cache,
    budget,
    geocoder,
    resolveInput: createResolver({ geocoder, cache }),
    matrix: createMatrixService({ providers: matrixProviders, cache }),
    geometry: chainGeometry(geometries),
    ai: createAiService(aiProviders),
    // Autocompletar só com a TomTom (o Nominatim não permite autocompletar).
    suggest: tomtomKey ? createTomTomSuggest(tomtomKey, cache) : noSuggest,
  };
  return services;
}
