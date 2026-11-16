import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // O projeto fica no Google Drive, que não avisa o Next sobre arquivos alterados.
  // Sem polling, o `next dev` continua servindo código antigo. Só afeta o modo dev.
  // Se o projeto for para um disco local, esta opção pode ser removida.
  watchOptions: { pollIntervalMs: 1000 },
  // Pelo mesmo motivo, o cache em disco do Turbopack ficava com arquivos antigos
  // (o CSS, principalmente) entre uma execução e outra do `next dev`.
  experimental: { turbopackFileSystemCacheForDev: false },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
