import { ImageResponse } from "next/og";

/** Ícone da tela inicial no iPhone/iPad (o Safari não usa o favicon em SVG). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  // Mesmo desenho do icon.svg, sem o canto arredondado: o iOS aplica a própria máscara.
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#2456d6" }}>
        <svg width="180" height="180" viewBox="0 0 64 64">
          <path
            d="M17 17h20a8 8 0 0 1 0 16H27a8 8 0 0 0 0 16h20"
            fill="none"
            stroke="#fff"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="17" cy="17" r="6.5" fill="#fff" />
          <circle cx="47" cy="49" r="5.5" fill="#2456d6" stroke="#fff" strokeWidth="4" />
        </svg>
      </div>
    ),
    size,
  );
}
