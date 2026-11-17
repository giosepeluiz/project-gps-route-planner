# Prompt para o Claude Code: Planejador de rotas multi-parada

Cole tudo abaixo no Claude Code, dentro de uma pasta vazia do novo projeto.

---

## 0. Como trabalhar

- Este é um projeto NOVO e separado. NÃO altere o repositório `project-coordinate-converter` (github.com/giosepeluiz/project-coordinate-converter). Ele serve só de referência: leia, copie e adapte o que precisar para dentro deste projeto.
- Trabalhe em fases (seção 12). Ao fim de cada fase: rode lint, typecheck e testes, faça um commit com mensagem clara e me conte em 3 a 5 linhas o que ficou pronto. Não pergunte nada que já esteja decidido aqui. Pergunte só quando algo for ambíguo ou irreversível.
- Antes de usar qualquer API externa, leia a documentação oficial atual (limites, endpoints e nomes de modelos de IA mudam). Não confie em memória.
- Idioma da interface, dos textos e dos comentários: português do Brasil. Números sempre com ponto decimal (ex.: 12.5 km).

## 1. Objetivo

Site pessoal (só para mim, por enquanto) que planeja a melhor sequência de paradas de carro.

- Entrada: um ponto de início, até 20 paradas e, opcionalmente, um ponto final.
- Saída: a ordem otimizada por tempo de carro (com trânsito previsto para a data e hora escolhidas), os horários estimados de chegada e o mapa com a rota.
- Meta: uma rota que faça sentido, sem ficar indo e voltando. Exemplo: Barreiro → Belém → Parque das Nações → Costa da Caparica é uma sequência ruim por causa do Tejo. A ordem certa vem do tempo real de carro, nunca da distância em linha reta.
- Não há tempo de permanência nas paradas (0 min). Deixe `dwellMinutes = 0` no modelo de dados para uso futuro, sem interface.

## 2. Stack

- Next.js (App Router), React, TypeScript, Tailwind, Vitest e ESLint, a mesma família do conversor (Next 16, React 19, Tailwind 4).
- Alvo de deploy: Vercel. Funções serverless, então não dependa de sistema de arquivos gravável.
- Mapa: MapLibre GL JS.

## 3. Mapa

- MapLibre GL JS com tiles vetoriais do OpenFreeMap (estilo `https://tiles.openfreemap.org/styles/liberty`), sem chave de API.
- Atribuição "© OpenStreetMap contributors" e OpenFreeMap sempre visível.
- Estilo reserva configurável por variável de ambiente (ex.: MapTiler com `MAPTILER_KEY`, uso não comercial), ativado automaticamente se o estilo principal falhar ao carregar (evento `error`).
- NÃO usar `tile.openstreetmap.org` (política de uso leve) e NÃO usar nenhuma API do Google (Maps JS, Directions, Distance Matrix, Geocoding ou Places).
- O mapa ocupa a tela inteira.
  - Pins: A (início), B (fim, quando existir) e números nas paradas, na ordem otimizada.
  - Rota desenhada pela geometria real quando o provedor devolver (seção 7). Sem geometria, linhas retas tracejadas marcadas como "aproximado".
- Clicar no mapa adiciona uma parada (pin), com aviso rápido "Desfazer".

## 4. Layout e HUD

Desktop (largura ≥ 768 px): HUD à direita, com cards de cerca de 320 px.
Celular (< 768 px): gaveta inferior (bottom sheet) com alça. A alça mostra o resumo ("2 h 13 min · 4 paradas · chega 11:05") e abre/fecha ao toque. O mapa se ajusta ao espaço livre (`fitBounds` com padding conforme a altura da gaveta).

Todos os blocos são colapsáveis e expansíveis: cabeçalho clicável com chevron e `aria-expanded`. Quando recolhido, o bloco mostra um resumo curto (ex.: "Barreiro · ida e volta", "4 paradas"). O estado fica salvo em `localStorage`.

**Bloco 1: Início e fim**
- Campo Início.
- Switch ligado por padrão: "O local de fim é o mesmo do início" (ida e volta). Com o switch ligado, o campo Fim fica desabilitado, com o texto "Igual ao início". Ao desligar, o campo Fim é liberado.
- Horário: seletor "Sair em" / "Chegar até" e campo de data e hora. O padrão é a data e hora atuais do usuário (fuso do navegador). Botão "Agora" restaura o padrão.

**Bloco 2: Paradas (n/20)**
- Lista na ordem otimizada. Cada item mostra: número, nome, minutos desde a parada anterior, horário estimado de chegada e botão de remover.
- Campo "Adicionar parada" (Enter ou botão +).
- Máximo de 20: ao tentar passar, mostrar "Limite de 20 paradas.".
- A partir de 11 paradas, mostrar aviso âmbar: "Com 11 ou mais paradas, a ordem é aproximada e pode não ser a melhor."

**Bloco 3: Resumo**
- Tempo total (ida e volta quando aplicável), horário de saída e de chegada.
- Comparação com a ordem digitada e economia em minutos.
- Fonte dos dados (TomTom com trânsito, ou "sem previsão de trânsito" quando cair na reserva) e se a ordem é exata ou aproximada.
- Selo da camada de IA: primária, backup ou local (seção 9).

Acessibilidade: foco visível, navegação por teclado, contraste adequado e suporte a tema claro e escuro (`prefers-color-scheme`).

## 5. Entrada de locais (início, fim e paradas)

Cada campo aceita:

1. Endereço completo ou texto livre (geocodificação, seção 8).
2. Clique no mapa.
3. Coordenadas: decimal (com hemisfério N/S/E/W/L/O), DMS e DDM. Aceitar vírgula decimal na entrada.
4. Link de qualquer serviço de mapas:
   - Google Maps: `?q=`, `@lat,lng`, `/place/`, `/search/`, `/dir/`, `?api=1&query=`, marcador `!3d…!4d…` (tem prioridade sobre o centro), domínios regionais (google.com.br, google.pt) e `maps.app.goo.gl`.
   - Waze: `waze.com/ul?ll=`, `live-map/directions?to=ll.`, `waze.com/ul/h…`, `ul.waze.com`, `waze://`.
   - Apple Maps: `?ll=`, `?q=`, `?daddr=`, `/place?coordinate=`, `maps.apple/p/…`, `maps://`.
   - TomTom: `tomtomgo://x-callback-url/navigate?destination=`, `tomtomhome:geo:action=show&lat=…&long=…`.
   - HERE WeGo: `share.here.com/l/LAT,LNG`, `share.here.com/r/…` (rota: usa o primeiro ponto), `wego.here.com/?map=`.
   - Yandex: `?pt=LNG,LAT` (longitude primeiro), `maps.yandex.*`, `?rtext=`, `yandexmaps://`.
   - Organic Maps: `omaps.app/LAT,LNG[/nome]` (os códigos `omaps.app/XXXX` e `ge0.me` não decodificam).
   - `geo:LAT,LNG` e `geo:0,0?q=Nome` (busca por nome).
   - OpenStreetMap: `#map=`, `mlat` e `mlon`.
   - Bing: `cp=` e `sp=point.`.
   - O próprio coordenadas.arqueirover.de: `/?c=`, `/LAT,LNG`, `/c/`, `/coord/`, `/https://maps…`.
   - Texto de compartilhamento que contenha um link: extrair o link.

Reaproveitamento do conversor (somente leitura, copiar e adaptar):
- `src/lib/coordinates.ts`, `map-urls.ts`, `deep-links.ts`, `services.ts`, `resolve.ts`, `geocode-queries.ts` e os testes `*.test.ts`.
- A API `GET /api/resolve?u=…`, que resolve links curtos no servidor.
- Links curtos (`maps.app.goo.gl`, `waze.com/ul/h…`, `maps.apple/p/…`) só resolvem no servidor: allowlist de domínios, timeout curto e limite de redirecionamentos (evitar SSRF).

Cada entrada vira `{ id, label, lat, lng, source: "address" | "pin" | "coords" | "link", confidence }`. Em caso de erro, mensagem inline sem travar a tela: "Não encontrei esse local. Tente mais detalhes, coordenadas ou um link.".

Locais duplicados (mesmas coordenadas, tolerância de 20 m): avisar e ignorar o duplicado.

## 6. Otimização

- Ponto de partida fixo. Fim igual ao início (ciclo) ou fim escolhido (caminho).
- Matriz N×N de tempos em segundos, ASSIMÉTRICA (não assuma simetria), para a data e hora de saída escolhidas.
- Até 10 paradas: solução exata (Held-Karp com início e fim fixos).
- De 11 a 20 paradas: heurística (vizinho mais próximo + 2-opt + Or-opt, com limite de iterações e de tempo) e aviso de ordem aproximada.
- A ordem NUNCA vem da IA. Vem do algoritmo.
- Modo "Chegar até": saída = chegada menos a duração total, em até 3 iterações. Recalcular a matriz quando o horário de saída mudar de faixa de 15 minutos.
- Sempre calcular também o custo da ordem digitada, para comparação.

## 7. Provedores de tempo e rota (cadeia com fallback)

Interface: `MatrixProvider { name; trafficAware; getMatrix(points, departAt): Promise<{ seconds: number[][]; meters?: number[][]; source: string }> }`.

1. **TomTom (primário, com trânsito).** Matrix Routing v2 com `departAt` e trânsito histórico/ao vivo. Confirmar na documentação oficial os limites e o formato (síncrono x assíncrono). Plano gratuito, chave em `TOMTOM_API_KEY`.
2. **OSRM ou OpenRouteService (reserva, SEM trânsito).** Confirmar na documentação os limites gratuitos e a política de uso. O servidor demo público do OSRM só serve para desenvolvimento. Para uso real, preferir OpenRouteService (chave grátis, `ORS_API_KEY`) ou instância própria. Mostrar na interface "sem previsão de trânsito".
3. **Último recurso:** estimativa por distância (haversine × 1.4 ÷ 35 km/h), claramente rotulada como estimativa.

Regras comuns:
- Timeout de 8 s por provedor, 1 retry e circuit breaker simples (pular o provedor por 60 s após 3 falhas seguidas).
- Cache da matriz com chave = coordenadas arredondadas a 4 casas + dia da semana + faixa de 15 minutos + provedor. Interface `Cache` com duas implementações: memória (LRU) e Upstash Redis/Vercel KV (via variáveis de ambiente, opcional). Cache de geocodificação por 30 dias.
- Geometria da rota final: uma chamada ao TomTom Calculate Route com os pontos já ordenados, para desenhar no mapa e conferir o tempo.
- O Waze não tem API de rotas pública: nunca tentar usar dados do Waze para cálculo.

## 8. Geocodificação (cadeia com fallback)

1. **Nominatim público (OSM).** No servidor, fila global de no máximo 1 requisição por segundo, `User-Agent` identificando o app (`NOMINATIM_USER_AGENT`, ex.: "rotas-pessoal (contato@arqueirover.de)"), sem autocomplete (busca só no Enter ou no botão +) e sem geocodificação em massa. Viés de localização pela área visível do mapa.
2. **TomTom Geocoding (reserva).** Confirmar o limite gratuito atual na documentação.

Normalizar o texto antes de buscar e guardar em cache.

## 9. Camada de IA (opcional, nunca bloqueante)

Papel da IA:
- (a) Interpretar texto livre em locais (ex.: "farmácia perto do Colombo e depois Belém") e devolver JSON validado.
- (b) Revisar a ordem final e explicar em 2 a 3 frases, em português do Brasil, por que ela faz sentido, apontando qualquer vai-e-volta suspeito.
- (c) Nunca alterar a ordem sozinha. Se discordar, mostra como sugestão.

Cadeia: primária Gemini Flash (Google AI Studio, plano gratuito) → backup Groq (Llama) → sem IA. Sem IA, a interface continua funcionando e mostra "Algoritmo local (nenhuma IA respondeu)".

Regras:
- Chaves só no servidor (`GEMINI_API_KEY`, `GROQ_API_KEY`). Modelos configuráveis por variável de ambiente. Verifique na documentação oficial os nomes atuais dos modelos e os limites do plano gratuito, que mudam sem aviso.
- Saída estruturada validada com zod. Timeout de 8 s, 1 retry e circuit breaker.
- Enviar o mínimo de dados (apenas rótulos e a ordem, sem dados pessoais).
- Mostrar na interface qual provedor respondeu (selo: primária, backup ou local).

## 10. Ações de saída

- **Abrir no Google Maps:** `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…` na ordem otimizada. Respeitar o limite de waypoints da documentação e dividir em vários links se passar.
- **Navegar até a próxima parada no Waze:** `https://waze.com/ul?ll=LAT,LNG&navigate=yes` (o Waze aceita um destino por link).
- **Copiar rota** em texto e **Compartilhar** (Web Share API no celular).

## 11. Segurança e privacidade

O site é pessoal, mas ficará publicado na Vercel.

- Proteger o site e as rotas `/api` com senha simples: middleware com `APP_PASSWORD` e cookie httpOnly assinado. Assim ninguém consome as minhas cotas.
- Rate limit por IP nas rotas `/api` (ex.: 30 req/min), validação de entrada com zod e allowlist de domínios no `/api/resolve`.
- Chaves só em variáveis de ambiente. Criar `.env.example` completo. Nada de chave no cliente.
- Persistência apenas em `localStorage` (último estado da rota e preferências dos blocos). Sem banco de dados por enquanto.

Variáveis de ambiente: `TOMTOM_API_KEY`, `ORS_API_KEY` (opcional), `GEMINI_API_KEY`, `GROQ_API_KEY`, `NOMINATIM_USER_AGENT`, `MAPTILER_KEY` (opcional), `APP_PASSWORD`, `SESSION_SECRET`, `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` (opcionais).

## 12. Fases

- **F1:** estrutura do projeto, mapa, layout responsivo e blocos colapsáveis (com dados fictícios).
- **F2:** leitura de locais (coordenadas, links e geocodificação com fallback), `/api/resolve` e testes.
- **F3:** solver (Held-Karp, heurística e modo chegada) com testes usando os fixtures da seção 13.
- **F4:** provedores de matriz e rota com cache, fallback e rótulo de fonte, integrados à interface.
- **F5:** camada de IA com fallback.
- **F6:** ações de saída, senha, rate limit, README e deploy na Vercel.

## 13. Fixtures de teste (dados reais da TomTom, terça-feira 2026-11-17)

Locais (lat, lng):
- B Barreiro: 38.661328, -9.0758545
- Be Belém: 38.6967497, -9.2147201
- PN Parque das Nações: 38.7738904, -9.0941674
- CC Costa da Caparica: 38.6421751, -9.2315575
- PC Praça do Comércio: 38.707432, -9.1372925
- Bf Benfica (Colombo): 38.7511813, -9.2021464

Tempos de carro em segundos (trânsito histórico). Cada par foi medido em um só sentido, então trate a matriz como simétrica APENAS nestes fixtures.

```json
{
  "t0900": {
    "B":  { "Be": 3049, "PN": 2585, "CC": 2012, "PC": 3409, "Bf": 3041 },
    "Be": { "PN": 1894, "CC": 1493, "PC": 1170, "Bf": 810 },
    "PN": { "CC": 2464, "PC": 1815, "Bf": 1608 },
    "CC": { "PC": 2469, "Bf": 2178 },
    "PC": { "Bf": 1443 }
  },
  "t1800": {
    "B":  { "Be": 2605, "PN": 2409, "CC": 2002, "PC": 2961, "Bf": 2901 },
    "Be": { "PN": 1998, "CC": 1895, "PC": 1188, "Bf": 1074 },
    "PN": { "CC": 3052, "PC": 1549, "Bf": 1911 },
    "CC": { "PC": 1895, "Bf": 1848 },
    "PC": { "Bf": 1967 }
  }
}
```

Caso esperado: início e fim em B (ciclo), paradas [Be, PN, CC] na ordem digitada.
- Ordem digitada: 9419 s às 09:00 e 9657 s às 18:00.
- Ordem ótima: B → CC → Be → PN → B (ou a inversa), com 7984 s às 09:00 e 8304 s às 18:00.

Testes obrigatórios:
- Held-Karp igual à força bruta em 200 instâncias aleatórias com até 8 paradas.
- Heurística (11 a 20 paradas): média ≤ 1.10 × o custo do vizinho mais próximo corrigido e nunca pior que o vizinho mais próximo puro.
- Limite de 20 paradas e aviso a partir de 11.
- Switch "fim igual ao início" (ciclo x caminho).
- Modo "Chegar até" converge em até 3 iterações.
- Cadeia de provedores (matriz, geocodificação e IA) com mocks: falha do primário aciona o backup e a falha de todos aciona o último recurso.
- Parsers com todos os formatos da seção 5.

## 14. Definição de pronto

- Mapa em tela cheia com OpenFreeMap, sem nenhuma chamada ao Google.
- HUD à direita no desktop e gaveta inferior no celular, com todos os blocos colapsáveis.
- Switch de fim igual ao início ligado por padrão, e campo Fim liberado ao desligar.
- Horário "Sair em" / "Chegar até" com padrão na data e hora atuais.
- Até 20 paradas, com aviso de imprecisão a partir de 11 e solução exata até 10.
- Entrada por endereço, pin, coordenadas e links de todos os serviços listados.
- Cadeias de fallback funcionando e visíveis na interface (matriz, geocodificação e IA).
- Testes passando, `.env.example` e README prontos, e deploy na Vercel protegido por senha.
