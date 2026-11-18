import type { NextConfig } from "next";

/** Origem do estilo reserva do mapa (se houver), para a política de conteúdo. */
function fallbackMapOrigin(): string | null {
  const url = process.env.MAP_FALLBACK_STYLE_URL?.trim();
  if (url) {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }
  return process.env.MAPTILER_KEY?.trim() ? "https://api.maptiler.com" : null;
}

/**
 * Política de conteúdo: o navegador só carrega scripts do próprio site e só
 * conversa com o próprio servidor e com o servidor de mapas. Uma injeção de
 * HTML, se um dia escapar, não consegue carregar script de fora nem mandar
 * dados para outro lugar. Só em produção: o modo de desenvolvimento precisa de
 * eval e de WebSocket para a recarga automática.
 */
function contentSecurityPolicy(): string {
  const maps = ["https://tiles.openfreemap.org", fallbackMapOrigin()].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    // O Next injeta scripts inline (dados da página e o script de tema/fonte).
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${maps}`,
    "font-src 'self' data:",
    `connect-src 'self' ${maps}`,
    "worker-src 'self' blob:",
    "child-src blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Testar no telefone pela rede de casa (http://IP-do-PC:3000): o `next dev` bloqueia
  // os recursos de desenvolvimento vindos de outro endereço que não localhost.
  // Libera só as faixas de rede local. Não afeta o build de produção.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local"],
  // O projeto fica no Google Drive, que não avisa o Next sobre arquivos alterados.
  // Sem polling, o `next dev` continua servindo código antigo. Só afeta o modo dev.
  // Se o projeto for para um disco local, esta opção pode ser removida.
  watchOptions: { pollIntervalMs: 1000 },
  // Pelo mesmo motivo, o cache em disco do Turbopack ficava com arquivos antigos
  // (o CSS, principalmente) entre uma execução e outra do `next dev`.
  experimental: { turbopackFileSystemCacheForDev: false },
  poweredByHeader: false,
  async headers() {
    const production = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Só o próprio site pode pedir a localização; câmera, microfone e afins, ninguém.
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()" },
          ...(production
            ? [
                { key: "Strict-Transport-Security", value: "max-age=63072000" },
                { key: "Content-Security-Policy", value: contentSecurityPolicy() },
              ]
            : []),
        ],
      },
    ];
  },
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
