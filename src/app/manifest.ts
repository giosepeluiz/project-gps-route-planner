import type { MetadataRoute } from "next";

/** "Adicionar à tela inicial" no celular: nome, ícone e abertura em tela cheia. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Planejador de Rotas",
    short_name: "Rotas",
    description: "Planeja a melhor sequência de paradas de carro, com trânsito previsto.",
    lang: "pt-BR",
    start_url: "/",
    display: "standalone",
    background_color: "#e9e7e3",
    theme_color: "#2456d6",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
