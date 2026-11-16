/** Instâncias únicas (por processo) dos serviços do servidor, montadas pelas variáveis de ambiente. */
import { createCache, type Cache } from "./cache";
import { createGeocoder, createNominatim, createTomTom, type GeocodeProvider, type Geocoder } from "./geocode";
import {
  createMatrixService,
  createOrsMatrix,
  createTomTomMatrix,
  type MatrixProvider,
  type MatrixService,
} from "./matrix";
import { createResolver } from "./resolve";
import { createTomTomGeometry, noGeometry, type GeometryService } from "./route-geometry";

interface Services {
  cache: Cache;
  geocoder: Geocoder;
  resolveInput: ReturnType<typeof createResolver>;
  matrix: MatrixService;
  geometry: GeometryService;
}

let services: Services | null = null;

export function getServices(): Services {
  if (services) return services;

  const cache = createCache();
  const tomtomKey = process.env.TOMTOM_API_KEY?.trim();
  const orsKey = process.env.ORS_API_KEY?.trim();

  const geocoders: GeocodeProvider[] = [
    createNominatim(process.env.NOMINATIM_USER_AGENT?.trim() || "rotas-pessoal/1.0"),
  ];
  if (tomtomKey) geocoders.push(createTomTom(tomtomKey));
  const geocoder = createGeocoder({ providers: geocoders, cache });

  // TomTom (com trânsito) → OpenRouteService (sem trânsito) → estimativa (sempre presente).
  const matrixProviders: MatrixProvider[] = [];
  if (tomtomKey) matrixProviders.push(createTomTomMatrix(tomtomKey));
  if (orsKey) matrixProviders.push(createOrsMatrix(orsKey));

  services = {
    cache,
    geocoder,
    resolveInput: createResolver({ geocoder, cache }),
    matrix: createMatrixService({ providers: matrixProviders, cache }),
    geometry: tomtomKey ? createTomTomGeometry(tomtomKey, cache) : noGeometry,
  };
  return services;
}
