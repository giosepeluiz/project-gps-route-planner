# Planejador de rotas multi-parada

Site pessoal que planeja a melhor sequência de paradas de carro: um ponto de início, até 20 paradas e, opcionalmente, um ponto final. A especificação completa está em [prompt-claude-code-planejador-de-rotas.md](prompt-claude-code-planejador-de-rotas.md).

## Estado atual

| Fase | Conteúdo | Situação |
| --- | --- | --- |
| F1 | Estrutura, mapa, layout responsivo e blocos colapsáveis (dados fictícios) | Pronta |
| F2 | Leitura de locais (coordenadas, links, geocodificação) e `/api/resolve` | Pronta |
| F3 | Solver (Held-Karp, heurística e modo chegada) | A fazer |
| F4 | Provedores de matriz e rota, com cache e fallback | A fazer |
| F5 | Camada de IA com fallback | A fazer |
| F6 | Ações de saída, senha, rate limit e deploy na Vercel | A fazer |

Os tempos ainda vêm de dados fictícios (fixtures reais da TomTom); locais novos usam estimativa por distância. A ordem das paradas ainda não é otimizada (fase 3).

## Como usar o mapa

- **Clique esquerdo** em qualquer ponto: mostra o endereço e as coordenadas, com botões para adicionar como parada, início ou fim.
- **Clique direito** (ou toque longo no celular): adiciona um pin como parada, com "Desfazer".
- **Clique em um pin**: mostra os dados daquele local.

## Entrada de locais

Os campos aceitam endereço, coordenadas (decimal, DMS, DDM, com hemisférios e vírgula decimal) e links de Google Maps, Waze, Apple Maps, TomTom, HERE, Yandex, Organic Maps, OpenStreetMap, Bing e `geo:`.

- Coordenadas e links que já trazem a posição são lidos no navegador, sem rede.
- Links curtos (`maps.app.goo.gl`, `waze.com/ul/h…`, `maps.apple/p/…`) passam por `GET /api/resolve?u=…`, que só acessa uma lista fixa de domínios de mapas, valida cada redirecionamento e tem timeout curto.
- Endereços passam por `GET /api/geocode?q=…`: Nominatim (no máximo 1 requisição por segundo, sem autocomplete) e, se falhar, TomTom Geocoding. Os resultados ficam 30 dias em cache.

## Como rodar

```bash
npm install
npm run dev
```

Abra http://localhost:3000.

Outros comandos: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Vitest e ESLint.
- Mapa: MapLibre GL JS com tiles do OpenFreeMap (sem chave). Nenhuma API do Google.
- O worker do MapLibre é copiado para `public/maplibre/` por `scripts/copy-maplibre-worker.mjs` (roda sozinho no `postinstall`, `dev` e `build`).

## Variáveis de ambiente

Veja [.env.example](.env.example). Nenhuma é obrigatória por enquanto: sem `TOMTOM_API_KEY` a geocodificação usa só o Nominatim, e sem as do Upstash o cache fica em memória.
