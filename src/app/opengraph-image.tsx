import { ImageResponse } from "next/og";

/** Miniatura do link (WhatsApp, redes sociais, Slack…): 1200×630. */
export const alt = "Planejador de Rotas: a melhor sequência de paradas de carro";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          color: "#ffffff",
          background: "linear-gradient(135deg, #1b3fa8 0%, #2456d6 55%, #4a7bf0 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="120" height="120" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="15" fill="#ffffff" />
            <path d="M17 17h20a8 8 0 0 1 0 16H27a8 8 0 0 0 0 16h20" fill="none" stroke="#2456d6" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="17" cy="17" r="6.5" fill="#2456d6" />
            <circle cx="47" cy="49" r="5.5" fill="#ffffff" stroke="#2456d6" strokeWidth="4" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, opacity: 0.9 }}>rotas.arqueirover.de</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.05 }}>Planejador de Rotas</div>
          <div style={{ fontSize: 40, lineHeight: 1.3, opacity: 0.92 }}>
            A melhor ordem das paradas, com trânsito previsto, pausas e modo viagem.
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 30, fontWeight: 600 }}>
          {["Paradas na melhor ordem", "Modo viagem", "Relatório em PDF"].map((t) => (
            <div key={t} style={{ display: "flex", padding: "12px 26px", borderRadius: 999, background: "rgba(255,255,255,0.18)" }}>
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
