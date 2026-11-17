# 🤝 Como contribuir

Obrigado pelo interesse! Toda ajuda é bem-vinda: correção de bug, tradução, ideia ou melhoria de texto.

## Antes de começar

- Para bugs e ideias, abra uma **[Issue](https://github.com/giosepeluiz/project-gps-route-planner/issues)** contando o que aconteceu (ou o que você gostaria) e, se puder, como reproduzir.
- Para mudanças maiores, abra a Issue antes do Pull Request, para combinarmos o caminho.

## Rodando o projeto

```bash
npm install
cp .env.example .env.local   # as chaves são opcionais em desenvolvimento
npm run dev
```

Abra http://localhost:3000. Sem nenhuma chave o app funciona com a estimativa por distância e o Nominatim.

## Antes de enviar

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Os quatro precisam passar. Se mexer em textos da interface, atualize os quatro idiomas em `src/lib/messages/` (o TypeScript e um teste avisam se faltar alguma chave).

## Regras do projeto

- **Nenhuma API do Google** para mapa, rota, busca ou geocodificação (o Gemini, de IA, é a exceção).
- **Chaves só no servidor.** Nada de chave no código do navegador nem no repositório.
- **A ordem das paradas vem sempre do algoritmo.** A IA só comenta e sugere; a sugestão é conferida com os tempos reais antes de ser oferecida.
- Textos da interface curtos e claros, nos quatro idiomas.

## Passo a passo

1. Faça um **fork** do projeto.
2. Crie uma branch: `git checkout -b minha-melhoria`
3. Faça o commit: `git commit -m "Adiciona tal coisa"`
4. Envie para o seu fork: `git push origin minha-melhoria`
5. Abra um **Pull Request** contando o que mudou e como testar.
