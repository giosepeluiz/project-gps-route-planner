# Planejador de rotas multi-parada

Site pessoal que planeja a melhor sequência de paradas de carro: um ponto de início, até 20 paradas e, opcionalmente, um ponto final. A especificação completa está em [prompt-claude-code-planejador-de-rotas.md](prompt-claude-code-planejador-de-rotas.md).

## Estado atual

| Fase | Conteúdo | Situação |
| --- | --- | --- |
| F1 | Estrutura, mapa, layout responsivo e blocos colapsáveis (dados fictícios) | Pronta |
| F2 | Leitura de locais (coordenadas, links, geocodificação) e `/api/resolve` | Pronta |
| F3 | Solver (Held-Karp, heurística e modo chegada) | Pronta |
| F4 | Provedores de matriz e rota, com cache e fallback | Pronta |
| F5 | Camada de IA com fallback | Pronta |
| F6 | Ações de saída, rate limit e deploy na Vercel | Pronta (falta só publicar; a senha foi dispensada) |

## Tempos e rota

O navegador envia os locais (só ids e coordenadas) para `POST /api/plan`, que monta a matriz de tempos, roda o solver e devolve a ordem, os trechos, a fonte dos dados e a linha da rota.

Cadeia de provedores, sempre visível no bloco Resumo:

1. **TomTom** (`TOMTOM_API_KEY`): Matrix Routing v2 com trânsito (ao vivo para saídas na próxima hora, histórico para as demais) e Calculate Route para desenhar a rota real e conferir o tempo.
2. **OpenRouteService** (`ORS_API_KEY`, opcional): sem previsão de trânsito.
3. **Estimativa por distância** (haversine × 1.4 ÷ 35 km/h): último recurso, sempre rotulada como estimativa. É o que aparece quando nenhuma chave está configurada.

Cada provedor tem timeout de 8 s, 1 retry e pausa de 60 s após 3 falhas seguidas.

### Duas linhas no mapa

- **Azul pontilhada:** retas ligando os pontos, sempre presente.
- **Colorida:** a rota pelas ruas (TomTom Calculate Route), com uma cor por trecho (nenhuma azul); a mesma cor aparece ao lado de cada parada na lista. Clicar nela mostra a distância em km e o tempo médio daquele trecho. Sem essa geometria, aparece o aviso "Traçado aproximado".

Sem `TOMTOM_API_KEY`, e **só em desenvolvimento** (`npm run dev`), a linha colorida vem do servidor demo público do OSRM, sem trânsito. A política dele não permite uso em produção, então no deploy a linha colorida depende da chave da TomTom.

### Sem travessia por mar

Carro não atravessa o mar: o traçado de cada trecho na TomTom pede para evitar balsas (`avoid=ferries`) e as seções de balsa (`sectionType=ferry`). Como o `avoid` da TomTom é só uma preferência, uma rota que ainda venha com seção de balsa é recusada. Pontes, túneis e trens de carros (como o Eurotúnel) continuam valendo. A matriz de tempos (Matrix v2) não aceita evitar balsas, então essa trava fica no traçado. Quando a matriz com trânsito ao vivo responde "sem rota" (acontece com interdições momentâneas, como numa praça fechada), o pedido é repetido com o trânsito histórico antes de concluir que não há caminho. Quando o provedor responde que não existe caminho de carro entre dois locais, a rota não é calculada e o bloco Paradas mostra o aviso, em vez de cair na estimativa em linha reta.

Limites: a estimativa por distância sozinha não sabe onde há mar, então esse bloqueio depende de um provedor de rotas responder. O servidor demo do OSRM (desenvolvimento) não aceita excluir balsas; nele, o bloqueio vale para pontos sem estrada por perto ou sem ligação por terra.

**Cota da TomTom:** o plano gratuito tem 2.500 requisições de matriz por mês, e tudo indica que cada célula conta (uma rota com 20 paradas são 441 células). Para poupar: o cache é por par de locais (chave = coordenadas com 4 casas + dia da semana + faixa de 15 minutos + provedor), então uma parada nova só consulta os pares novos; e com o horário em "Agora" a rota não é recalculada sozinha com o passar do tempo, só quando algo muda.


## Ordem das paradas

A ordem vem sempre do algoritmo (`src/lib/solver.ts`), nunca da IA, e a lista de paradas se reorganiza sozinha quando uma ordem melhor é encontrada.

- Até 10 paradas: solução exata (Held-Karp), com início e fim fixos.
- De 11 a 20: heurística (vizinho mais próximo + 2-opt + Or-opt), com aviso de ordem aproximada.
- **Ordem manual, por local:** arraste uma parada pela alça para reposicioná-la; ela fica travada na posição em que foi solta (cadeado). O cadeado de cada parada trava ou destrava só aquele local. Os locais destravados continuam sendo otimizados em volta dos travados, e o Resumo mostra quanto a rota levaria sem as travas. Com o teclado, as setas para cima e para baixo na alça fazem o mesmo.
- **Tempo de permanência:** o relógio em cada parada define quanto tempo você fica nela (atalhos de 5 min a 2 h, ou qualquer valor até 12 h). O total do Resumo soma direção e permanência, os horários de chegada e saída de cada parada levam isso em conta, e no "Chegar até" a saída é antecipada. A permanência do último local, onde a rota termina, não conta. A permanência padrão das novas paradas fica nas Configurações.
- A matriz de tempos é tratada como assimétrica.
- "Chegar até": a saída é a chegada menos a duração, recalculada em até 3 iterações quando muda de faixa de 15 minutos (entra em uso com os provedores de trânsito, na fase 4).

## Camada de IA (opcional)

A IA nunca decide a ordem e nunca bloqueia a interface. Ela faz duas coisas:

- **Comenta a ordem final** em 2 a 3 frases e aponta um possível vai-e-volta. Se discordar, mostra a sugestão e a nova ordem; o botão **Aceitar sugestão** trava cada parada na posição sugerida (dá para destravar pelo cadeado). A ordem sugerida só aparece se for uma troca válida das paradas atuais, e o Resumo continua mostrando quanto a rota levaria sem as travas.
- **Interpreta texto livre:** se o campo "Adicionar parada" não encontrar o que foi digitado (por exemplo "farmácia perto do Colombo e depois Belém"), a IA separa o texto em buscas e cada uma passa pela geocodificação normal.

Cadeia: Gemini Flash-Lite (`GEMINI_API_KEY`, primária, padrão `gemini-3.5-flash-lite`) → Groq (`GROQ_API_KEY`, backup, padrão `openai/gpt-oss-120b`) → sem IA. O selo no Resumo mostra quem respondeu: Primária ou Backup (com o ícone de IA), ou Local ("Algoritmo local (nenhuma IA respondeu)"). O nome do modelo não aparece na tela. As respostas são validadas com zod, com timeout de 8 s, 1 retry e circuit breaker.

Só saem para a IA os rótulos dos locais, a ordem e os minutos de cada trecho (sem coordenadas), ou o texto digitado no caso da interpretação. Os modelos são configuráveis por `GEMINI_MODEL` e `GROQ_MODEL`, porque os nomes mudam com frequência.

## Busca de endereços

- **Sugestões enquanto digita:** a partir de 3 letras, depois de uma pausa curta, os campos de endereço mostram sugestões da busca da TomTom (`typeahead`), com preferência pela área visível do mapa. Setas e Enter escolhem; a sugestão já traz as coordenadas, sem nova busca. O Nominatim não entra aqui porque a política de uso dele proíbe autocompletar. Cada pedido gasta cota da TomTom; as respostas ficam um dia em cache. Sem chave da TomTom, não há sugestões e o Enter continua funcionando.
- **Nome da zona:** um local digitado como coordenadas (ou link com coordenadas) recebe o nome do bairro ou da freguesia e a cidade (ex.: "Campo Pequeno, Lisboa"), pelo Nominatim e, de reserva, pela TomTom. Vale para a lista, o Resumo e o comentário da IA; as coordenadas continuam no balão do mapa.

## Abrir e compartilhar

- **Abrir no Google Maps:** link de rota na ordem otimizada. O Google aceita até 9 paradas por link (3 nos navegadores de celular); acima disso a rota é dividida em partes encadeadas.
- **Navegar no Waze:** abre a navegação até a próxima parada (o Waze aceita um destino por link).
- **Copiar rota** em texto e **Compartilhar** (onde o navegador oferece compartilhamento).

## Configurações

A engrenagem junto do zoom abre a tela de Configurações (em tela cheia no celular). Ela guarda no navegador o tema (sistema, claro ou escuro), o tamanho do texto, a permanência padrão das novas paradas e a posição dos blocos. "Restaurar tudo" desfaz tudo.

- **Texto:** "Pequeno" é o padrão, na escala do Google Maps (14 px no texto principal, 12 px no secundário). Os tamanhos maiores escalam a interface inteira.
- **Blocos:** no desktop, cada bloco é um cartão sobre o mapa, arrastável pelo título. Perto da borda esquerda ou direita ele gruda numa coluna, na posição em que foi solto; perto do topo ou da base, gruda na margem; no resto da tela fica solto onde foi largado. Os controles do mapa ficam ao lado das colunas. No celular os blocos ficam na gaveta, na mesma ordem. "Voltar os blocos ao lugar padrão" fica nas Configurações.
- **Enquadramento:** o mapa reenquadra a rota quando os locais mudam ou quando um bloco muda de lugar, usando o espaço que os blocos deixam livre. Abrir ou fechar um bloco, ou o Resumo crescer com o comentário da IA, não mexe no zoom.

## Acesso e segurança

- **Sem senha:** o site é aberto (decisão de 2026-11-17). Quem tiver o endereço consegue usar, e cada uso consome as cotas das chaves configuradas.
- **Limite de requisições:** 60 por minuto por IP nas rotas `/api` (`RATE_LIMIT_PER_MIN`). O contador fica na memória de cada instância do servidor, então na Vercel é uma proteção simples, não uma garantia.
- Entradas validadas com zod, chaves só no servidor e lista fixa de domínios no `/api/resolve`.

## Publicar na Vercel

1. Suba o repositório para o GitHub e importe o projeto na Vercel (framework Next.js, sem ajustes de build).
2. Em Settings > Environment Variables, cadastre no mínimo `TOMTOM_API_KEY`. Recomendadas: `GEMINI_API_KEY`, `GROQ_API_KEY` e `NOMINATIM_USER_AGENT` com um contato real. Opcionais: `ORS_API_KEY`, `MAPTILER_KEY`, `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
3. Faça o deploy. Sem `TOMTOM_API_KEY` em produção não há linha pelas ruas (o OSRM de demonstração só vale em desenvolvimento) e os tempos são estimativa.

## Como usar o mapa

- **Clique esquerdo** em qualquer ponto: abre um balão com o endereço e as coordenadas (clicáveis para copiar) e pergunta o que fazer com o local: adicionar como parada, definir como início ou definir como fim.
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

As chaves ficam em `.env.local` (fora do git); copie de [.env.example](.env.example). Depois de alterar esse arquivo, reinicie o servidor.

Observação: esta cópia do projeto fica no Google Drive, onde o `npm install` falha. Nesse caso, instale em uma pasta de disco local e copie o `node_modules` para cá.

Abra http://localhost:3000.

Outros comandos: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Vitest e ESLint.
- Mapa: MapLibre GL JS com tiles do OpenFreeMap (sem chave). Nenhuma API do Google.
- O worker do MapLibre é copiado para `public/maplibre/` por `scripts/copy-maplibre-worker.mjs` (roda sozinho no `postinstall`, `dev` e `build`).

## Variáveis de ambiente

Veja [.env.example](.env.example). Em desenvolvimento nenhuma é obrigatória: sem `TOMTOM_API_KEY` os tempos são estimativa e a geocodificação usa só o Nominatim; sem chaves de IA o selo fica em "Local"; sem as do Upstash o cache fica em memória.
