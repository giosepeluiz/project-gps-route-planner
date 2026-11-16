# Planejador de rotas multi-parada

Site pessoal que planeja a melhor sequência de paradas de carro: um ponto de início, até 20 paradas e, opcionalmente, um ponto final. A especificação completa está em [prompt-claude-code-planejador-de-rotas.md](prompt-claude-code-planejador-de-rotas.md).

## Estado atual

| Fase | Conteúdo | Situação |
| --- | --- | --- |
| F1 | Estrutura, mapa, layout responsivo e blocos colapsáveis (dados fictícios) | Pronta |
| F2 | Leitura de locais (coordenadas, links, geocodificação) e `/api/resolve` | Pronta |
| F3 | Solver (Held-Karp, heurística e modo chegada) | Pronta |
| F4 | Provedores de matriz e rota, com cache e fallback | Pronta |
| F5 | Camada de IA com fallback | A fazer |
| F6 | Ações de saída, senha, rate limit e deploy na Vercel | A fazer |

## Tempos e rota

O navegador envia os locais (só ids e coordenadas) para `POST /api/plan`, que monta a matriz de tempos, roda o solver e devolve a ordem, os trechos, a fonte dos dados e a linha da rota.

Cadeia de provedores, sempre visível no bloco Resumo:

1. **TomTom** (`TOMTOM_API_KEY`): Matrix Routing v2 com trânsito (ao vivo para saídas na próxima hora, histórico para as demais) e Calculate Route para desenhar a rota real e conferir o tempo.
2. **OpenRouteService** (`ORS_API_KEY`, opcional): sem previsão de trânsito.
3. **Estimativa por distância** (haversine × 1.4 ÷ 35 km/h): último recurso, sempre rotulada como estimativa. É o que aparece quando nenhuma chave está configurada.

Cada provedor tem timeout de 8 s, 1 retry e pausa de 60 s após 3 falhas seguidas. Sem geometria, o mapa mostra retas tracejadas com o aviso "Traçado aproximado".

**Cota da TomTom:** o plano gratuito tem 2.500 requisições de matriz por mês, e tudo indica que cada célula conta (uma rota com 20 paradas são 441 células). Para poupar: o cache é por par de locais (chave = coordenadas com 4 casas + dia da semana + faixa de 15 minutos + provedor), então uma parada nova só consulta os pares novos; e com o horário em "Agora" a rota não é recalculada sozinha com o passar do tempo, só quando algo muda.


## Ordem das paradas

A ordem vem sempre do algoritmo (`src/lib/solver.ts`), nunca da IA, e a lista de paradas se reorganiza sozinha quando uma ordem melhor é encontrada.

- Até 10 paradas: solução exata (Held-Karp), com início e fim fixos.
- De 11 a 20: heurística (vizinho mais próximo + 2-opt + Or-opt), com aviso de ordem aproximada.
- A matriz de tempos é tratada como assimétrica.
- "Chegar até": a saída é a chegada menos a duração, recalculada em até 3 iterações quando muda de faixa de 15 minutos (entra em uso com os provedores de trânsito, na fase 4).

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
