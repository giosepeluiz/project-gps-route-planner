# Planejador de rotas multi-parada

Site pessoal que planeja a melhor sequência de paradas de carro: um ponto de início, até 20 paradas e, opcionalmente, um ponto final. A especificação completa está em [prompt-claude-code-planejador-de-rotas.md](prompt-claude-code-planejador-de-rotas.md).

## Estado atual

| Fase | Conteúdo | Situação |
| --- | --- | --- |
| F1 | Estrutura, mapa, layout responsivo e blocos colapsáveis (dados fictícios) | Pronta |
| F2 | Leitura de locais (coordenadas, links, geocodificação) e `/api/resolve` | A fazer |
| F3 | Solver (Held-Karp, heurística e modo chegada) | A fazer |
| F4 | Provedores de matriz e rota, com cache e fallback | A fazer |
| F5 | Camada de IA com fallback | A fazer |
| F6 | Ações de saída, senha, rate limit e deploy na Vercel | A fazer |

Na F1 os tempos vêm de dados fictícios (fixtures reais da TomTom) e os campos de texto só aceitam coordenadas decimais.

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

Veja [.env.example](.env.example). Na F1 nenhuma é obrigatória.
