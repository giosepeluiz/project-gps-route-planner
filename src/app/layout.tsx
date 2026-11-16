import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SETTINGS_BOOT_SCRIPT } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Planejador de rotas",
  description: "Planeja a melhor sequência de paradas de carro, com trânsito previsto.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: o script abaixo define data-theme e o tamanho da fonte no <html>.
    <html lang="pt-BR" data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Padrão da documentação do Next: o tipo muda no cliente para o React não avisar sobre <script>. */}
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: SETTINGS_BOOT_SCRIPT }}
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
