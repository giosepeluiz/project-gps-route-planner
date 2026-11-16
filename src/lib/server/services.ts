/** Instâncias únicas (por processo) dos serviços do servidor, montadas pelas variáveis de ambiente. */
import { createCache, type Cache } from "./cache";
import { createGeocoder, createNominatim, createTomTom, type GeocodeProvider, type Geocoder } from "./geocode";
import { createResolver } from "./resolve";

interface Services {
  cache: Cache;
  geocoder: Geocoder;
  resolveInput: ReturnType<typeof createResolver>;
}

let services: Services | null = null;

export function getServices(): Services {
  if (services) return services;

  const cache = createCache();
  const providers: GeocodeProvider[] = [
    createNominatim(process.env.NOMINATIM_USER_AGENT?.trim() || "rotas-pessoal/1.0"),
  ];
  const tomtomKey = process.env.TOMTOM_API_KEY?.trim();
  if (tomtomKey) providers.push(createTomTom(tomtomKey));

  const geocoder = createGeocoder({ providers, cache });
  services = { cache, geocoder, resolveInput: createResolver({ geocoder, cache }) };
  return services;
}
