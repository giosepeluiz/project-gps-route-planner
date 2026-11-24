/** Instâncias únicas (por processo) dos serviços do servidor, montadas pelas variáveis de ambiente. */
import { createAiService, createGemini, createGroq, type AiProvider, type AiService } from "./ai";
import { createCache, type Cache } from "./cache";
import { createGeocoder, createNominatim, createTomTom, type GeocodeProvider, type Geocoder } from "./geocode";
import {
  createHereMatrix,
  createMatrixService,
  createOrsMatrix,
  createTomTomMatrix,
  createTomTomPairwise,
  type MatrixProvider,
  type MatrixService,
} from "./matrix";
import { apiLimitPerMinute } from "./rate-limit";
import { createResolver } from "./resolve";
import { createTomTomSuggest, noSuggest, type SuggestService } from "./suggest";
import {
  chainGeometry,
  createOsrmDemoGeometry,
  createTomTomGeometry,
  type GeometryService,
} from "./route-geometry";

interface Services {
  cache: Cache;
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
  openRouteService: boolean;
  osrmDemo: boolean;
  gemini: { enabled: boolean; model: string };
  groq: { enabled: boolean; model: string };
  sharedCache: boolean;
  mapFallback: boolean;
  rateLimitPerMinute: number;
  /** Envio das estatísticas anônimas da viagem por e-mail. */
  tripReport: boolean;
}

export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
export const groqModel = () => process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

export function serviceStatus(): ServiceStatus {
  const has = (name: string) => !!process.env[name]?.trim();
  return {
    tomtom: has("TOMTOM_API_KEY"),
    here: has("HERE_API_KEY"),
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
  const tomtomKey = process.env.TOMTOM_API_KEY?.trim();
  const orsKey = process.env.ORS_API_KEY?.trim();
  const hereKey = process.env.HERE_API_KEY?.trim();

  const geocoders: GeocodeProvider[] = [
    createNominatim(process.env.NOMINATIM_USER_AGENT?.trim() || "rotas-pessoal/1.0"),
  ];
  if (tomtomKey) geocoders.push(createTomTom(tomtomKey));
  const geocoder = createGeocoder({ providers: geocoders, cache });

  // TomTom matriz → HERE matriz → TomTom rota a rota (todas com trânsito) → OpenRouteService
  // (sem trânsito) → estimativa (sempre presente). Quando a cota de um acaba, passa para o seguinte.
  const matrixProviders: MatrixProvider[] = [];
  if (tomtomKey) matrixProviders.push(createTomTomMatrix(tomtomKey));
  if (hereKey) matrixProviders.push(createHereMatrix(hereKey));
  if (tomtomKey) matrixProviders.push(createTomTomPairwise(tomtomKey));
  if (orsKey) matrixProviders.push(createOrsMatrix(orsKey));

  // Rota pelas ruas: TomTom. Sem chave, e só em desenvolvimento, o servidor demo do OSRM.
  const geometries: GeometryService[] = [];
  if (tomtomKey) geometries.push(createTomTomGeometry(tomtomKey, cache));
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
