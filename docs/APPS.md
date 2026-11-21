# Apps para Windows, Linux e Android: planejamento

Plano para levar o Planejador de Rotas (hoje um site em Next.js) a apps
instaláveis no **Windows**, no **Linux** e no **Android**, com tudo o que já
existe no site, visual moderno e recursos que só um app nativo permite.

Estado: **planejamento e preparação** (versão 0.8.1 do site). Nada foi
publicado em loja ainda.

---

## 1. Princípios

1. **Uma interface só.** Os três apps usam a mesma interface React do site.
   Uma correção no site vale para todos; nada é reescrito.
2. **As chaves ficam no servidor.** TomTom, ORS, Gemini, Groq e Resend
   continuam só no servidor da Vercel (`rotas.arqueirover.de/api/*`). O app
   nunca carrega uma chave.
3. **A ordem das paradas continua vindo do algoritmo**, nunca da IA (mesma
   regra do site).
4. **Nada de Google** para mapa, rota ou busca (mesma regra do site).
5. **Cara de app, não de site embrulhado:** barra de status integrada, botão
   voltar do Android, janela nativa no desktop, arquivos salvos onde o sistema
   espera.

## 2. Arquitetura escolhida

```text
            ┌───────────────────────────────────────────┐
            │  Interface React (src/components, src/lib) │
            └───────────────┬───────────────────────────┘
        build do site       │        build dos apps (exportação estática)
   (next build, Vercel)     │        NEXT_PUBLIC_API_BASE=https://rotas.arqueirover.de
            │               │                     │
   rotas.arqueirover.de     │        ┌────────────┴────────────┐
   (site + /api/*)  ◄───────┼────────┤  Android: Capacitor 8   │
            ▲               │        │  Windows/Linux: Tauri 2 │
            │   chamadas    │        └─────────────────────────┘
            └── à API, com CORS liberado só para as origens dos apps
```

| Peça | Escolha | Por quê |
|---|---|---|
| **Android** | [Capacitor 8](https://capacitorjs.com) | Ecossistema maduro de plugins nativos, principalmente **GPS em segundo plano** (essencial para o modo viagem com a tela apagada), manter a tela acesa, compartilhar e salvar arquivos. |
| **Windows e Linux** | [Tauri 2](https://v2.tauri.app) (2.12, set/2026) | Instaladores pequenos (~10 MB, contra ~100 MB do Electron), usa o WebView do sistema (WebView2 no Windows, WebKitGTK no Linux), atualização automática assinada. |
| **API** | A mesma da Vercel | Nada muda no servidor além do CORS (já preparado). |

**Por que não usar só o Tauri, inclusive no Android?** O Tauri 2 roda no
Android, mas os plugins de GPS em segundo plano e de serviço em primeiro plano
ainda são bem menos maduros que os do Capacitor. Para um app de viagem, isso
pesa mais que ter uma ferramenta só.

**Por que não abrir o site dentro do app?** Funcionaria, mas:
(a) o app ficaria em branco sem internet, até para ver a rota já salva;
(b) a Google Play recusa apps que são só um site embrulhado;
(c) os recursos nativos (GPS com a tela apagada, notificação fixa, salvar o
PDF) ficam mais difíceis. A interface vai **empacotada** no app.

### 2.1 Build dos apps (exportação estática)

A exportação estática do Next
([guia](../node_modules/next/dist/docs/01-app/02-guides/static-exports.md)) não
aceita rotas de API com `POST` nem rotas dinâmicas sem `generateStaticParams`.
Por isso o build dos apps:

1. Copia o projeto para uma pasta temporária **sem** `src/app/api/` e sem
   `src/app/r/` (o link `/r/...` vira link de abertura do app, ver 2.3).
2. Liga `output: "export"` e define `NEXT_PUBLIC_API_BASE=https://rotas.arqueirover.de`.
3. Gera `out/`, que o Capacitor (`webDir`) e o Tauri (`frontendDist`) empacotam.

Script previsto: `scripts/build-app.mjs`. Comandos: `npm run build:app`,
`npm run android`, `npm run desktop`.

### 2.2 Camada de plataforma (`src/lib/platform.ts`)

Um só lugar decide como cada recurso funciona em cada plataforma. A
interface chama a camada, nunca a API do Capacitor ou do Tauri direto:

| Recurso | Site | Android (Capacitor) | Windows/Linux (Tauri) |
|---|---|---|---|
| GPS | `navigator.geolocation` | `@capgo/background-geolocation` (segue com a tela apagada, com notificação fixa) | `navigator.geolocation` do WebView (Windows: serviço de localização; Linux: GeoClue) |
| Tela acesa na viagem | Wake Lock API | `@capacitor-community/keep-awake` | não precisa |
| Compartilhar | `navigator.share` | `@capacitor/share` | copiar o link (+ abrir o e-mail) |
| Salvar o PDF | download do navegador | `@capacitor/filesystem` + compartilhar | diálogo "Salvar como" (`@tauri-apps/plugin-dialog` + `plugin-fs`) |
| Abrir Google Maps/Waze | link | intent do Android | abre no navegador padrão (`plugin-opener`) |
| Guardar a rota | `localStorage` | `localStorage` + `@capacitor/preferences` (entra no backup do Android) | `localStorage` |
| Aviso de chegada | modal | modal + **vibração** + notificação local | modal + notificação do sistema |
| Botão voltar | — | `@capacitor/app` (fecha modal, depois recolhe a bandeja, depois sai) | — |

### 2.3 Links de rota abrindo no app

- **Android:** *App Links* em `https://rotas.arqueirover.de/r/*`. O site publica
  `/.well-known/assetlinks.json` com a impressão digital da chave de assinatura;
  quem tem o app abre direto nele, quem não tem cai no site (como hoje).
- **Windows/Linux:** esquema `rotas://r/...` com o plugin `deep-link` do Tauri.
  O botão "Abrir no app" no site aparece só em desktop.
- O leitor de links (`src/lib/share-link.ts`) já é o mesmo nos três.

## 3. Estrutura no repositório

```text
apps/
  android/          projeto do Capacitor (gerado por `npx cap add android`)
  desktop/
    src-tauri/      projeto do Tauri (Rust), ícones, tauri.conf.json
scripts/
  build-app.mjs     exportação estática para os apps
src/lib/platform.ts camada de plataforma (site, Android, desktop)
docs/APPS.md        este plano
```

> **Importante (Google Drive):** o projeto está no Google Drive (`G:`), onde o
> `npm install` já falha. Gradle (Android) e Cargo (Rust) vão sofrer ainda mais
> lá. **Os builds nativos devem rodar numa cópia local** (ex.: `C:\dev\rotas`) ou
> no **GitHub Actions** (recomendado, ver 6).

## 4. Visual: moderno, sem cara de IA

Segue o estilo do site (tokens de cor do `globals.css`, Roboto/Segoe, poucos
efeitos), mais o jeito de cada sistema:

- **Android:** de borda a borda (*edge-to-edge*), barra de status e de navegação
  com a cor do mapa e da bandeja, **ícone adaptativo** (o "S" da rota sobre o
  azul `#2456d6`, com versão monocromática para o Android 13+), toque com
  vibração curta nas ações principais, bandeja que acompanha o gesto, sem
  "splash" chamativo (logo pequeno em fundo liso).
- **Windows:** janela com título integrado e material *Mica* (fundo
  translúcido do Windows 11), fonte Segoe UI Variable, atalhos de teclado
  (Ctrl+P relatório, Ctrl+L link, Ctrl+F busca).
- **Linux:** segue o tema claro/escuro do sistema (GTK), sem decoração própria.
- **Regras para não parecer "feito por IA":** sem gradientes roxos, sem emoji
  como ícone, sem textos genéricos ("Descubra o poder…"), ícones de traço
  único e do mesmo peso, animações curtas e só onde explicam algo. O símbolo de
  IA (estrelas + IA/AI) aparece só no que vem da IA.

## 5. Tudo o que já existe e vai junto

Planejamento multiparadas com o algoritmo exato, travas, permanência, pausas
para descanso, chegada numa parada específica, ordem comentada pela IA,
etiquetas de tempo e distância nos trechos, link compartilhável (com trava,
pausas, hora e hora de chegada na parada), modo viagem (seta Waze, 3D,
recálculo pela mão da via, cabeçalho com três telas, chegada magnética com
bandeira, conquista "Parada concluída", aviso de 1 km), estatísticas e
relatórios em PDF, e-mail com análise da IA, quatro idiomas, temas e tutorial.
**A viagem de teste** (carro simulado) também vai, escondida num menu de
desenvolvedor dos apps.

## 6. Distribuição

| Plataforma | Formato | Onde | Observações |
|---|---|---|---|
| Android | AAB (loja) e APK (direto) | Google Play; APK no GitHub Releases | Conta de desenvolvedor (taxa única de US$ 25). **GPS em segundo plano exige declaração na Play** (vídeo mostrando o uso e aviso claro dentro do app antes de pedir a permissão). Formulário de "Segurança dos dados": localização não sai do aparelho, só as coordenadas das paradas vão para o servidor calcular a rota. |
| Windows | instalador NSIS/MSI e MSIX | GitHub Releases e Microsoft Store | Sem certificado de assinatura, o Windows mostra o aviso do SmartScreen. A Microsoft Store assina o pacote (conta individual gratuita). |
| Linux | AppImage, .deb, .rpm | GitHub Releases; Flathub depois | O AppImage roda em quase todas as distribuições. |

**Automação (GitHub Actions):** a cada tag `vX.Y.Z`, um fluxo gera o APK/AAB,
os instaladores do Windows e os pacotes do Linux e publica tudo no
*Release* da tag, com as notas do histórico do README. As chaves de
assinatura ficam nos segredos do repositório (nunca no código).
**Atualização automática:** desktop pelo *updater* assinado do Tauri; Android
pela própria loja.

## 7. Segurança

- Chaves só no servidor (sem mudança).
- CORS liberado **só** para as origens dos apps (`https://localhost`,
  `capacitor://localhost`, `http://tauri.localhost`, `tauri://localhost`).
  **Já preparado** no `src/proxy.ts`.
- O limite por IP e a validação de tudo o que chega à API continuam iguais.
- Permissões mínimas: localização (na viagem), notificações e vibração. Sem
  contatos, câmera ou armazenamento amplo.
- Fase futura: *Play Integrity* para a API saber que a chamada vem do app
  oficial.

## 8. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **0. Preparação** *(feito na 0.8.1)* | `apiUrl()` em todas as chamadas, CORS para os apps, este plano | o site funciona igual e os testes passam |
| **1. Build dos apps** | `scripts/build-app.mjs`, `src/lib/platform.ts`, ícones e splash | `out/` abre no navegador e chama a API de produção |
| **2. Android (base)** | projeto Capacitor, GPS em primeiro plano, compartilhar, salvar o PDF, botão voltar, App Links | APK instalado no seu celular faz uma viagem completa |
| **3. Android (viagem de verdade)** | GPS com a tela apagada, notificação fixa com a próxima parada, vibração na chegada, tela acesa | viagem real com o celular no bolso |
| **4. Desktop** | Tauri para Windows e Linux, salvar PDF, links `rotas://`, Mica, atalhos | instalador do Windows e AppImage funcionando |
| **5. Lojas e CI** | GitHub Actions, assinatura, Play (teste interno → produção), Microsoft Store | uma tag gera e publica tudo |
| **6. Novos recursos** | ver a seção 9, pela ordem de prioridade | — |

## 9. Sugestões de novos recursos

Prioridade: ★★★ alta, ★★ média, ★ baixa.

| ★ | Recurso | Onde | O que faz |
|---|---|---|---|
| ★★★ | **Viagem com a tela apagada** | Android | O GPS segue no bolso; uma notificação fixa mostra a próxima parada, a chegada prevista e os botões *Pausar* e *Cheguei*. |
| ★★★ | **Avisos por voz** | todos | "Chegando em Belém em 500 metros", "Parada concluída", "Rota recalculada", pela voz do sistema, sem serviço externo. |
| ★★★ | **Rotas salvas e histórico** | todos | Guardar rotas com nome (as do dia a dia) e ver as viagens passadas com as estatísticas e os PDFs. |
| ★★★ | **Importar paradas de planilha** | todos | Colar ou abrir um CSV/Excel com endereços (e janelas de horário) e virar paradas de uma vez. |
| ★★ | **Janela de horário por parada** | todos | "Entre 9h e 11h": o algoritmo respeita e avisa quando não dá. |
| ★★ | **Mapa offline da região** | Android/desktop | Baixar a área da rota (PMTiles do OpenStreetMap) para ver o mapa sem sinal. |
| ★★ | **Compartilhar a viagem ao vivo** | todos | Um link que mostra onde o carro está e a chegada prevista, por tempo limitado. |
| ★★ | **Custo da viagem** | todos | Combustível ou energia (consumo do carro + preço) e portagens/pedágios estimados no Resumo e no PDF. |
| ★★ | **Widget e atalhos** | Android | Widget com a próxima parada; atalho "Nova rota" e "Continuar viagem" no ícone. |
| ★★ | **Contato por parada** | todos | Telefone e observação em cada parada, com botão de ligar ou mandar mensagem ao chegar. |
| ★ | **Comprovante de entrega** | Android | Foto e assinatura na parada, que entram no relatório final (para quem faz entregas). |
| ★ | **Modo noite automático no mapa** | todos | Mapa escuro ao anoitecer, durante a viagem. |
| ★ | **Android Auto** | Android | A próxima parada na tela do carro (exige aprovação específica da Google; fica por último). |

## 10. Decisões que dependem de você

1. **Nome nas lojas:** "Planejador de Rotas" (pt-BR), "Planeador de Rotas"
   (pt-PT), "Route Planner" (en), "Planificador de Rutas" (es)?
2. **Identificador do app:** proposta `de.arqueirover.rotas` (definitivo
   depois de publicado na Play).
3. **Conta de desenvolvedor da Google Play** (US$ 25, no seu nome) e,
   se quiser, conta da Microsoft Store (gratuita para pessoa física).
4. **Modo viagem no desktop:** só planejamento (recomendado) ou também a
   viagem num notebook?
5. **Quais novos recursos entram primeiro** (seção 9).
6. **Assinatura do Windows:** Microsoft Store (gratuita) ou certificado
   próprio (pago, ~US$ 100–300 por ano)?

## 11. Ferramentas para instalar (na fase 1)

Numa cópia local do projeto, fora do Google Drive:

- Node 22+ (já instalado)
- **Android:** Android Studio (SDK mais recente, API 36/37), JDK 21
- **Desktop:** Rust (`rustup`), Microsoft C++ Build Tools e WebView2 (Windows);
  no Linux, `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`
- Ou só o **GitHub Actions**, que já tem tudo isso nas máquinas dele.

Referências: [Tauri 2.12](https://v2.tauri.app/release/tauri/v2.12.0/),
[Capgo background geolocation](https://github.com/Cap-go/capacitor-background-geolocation),
[Capawesome background geolocation](https://capawesome.io/docs/sdks/capacitor/background-geolocation/).
