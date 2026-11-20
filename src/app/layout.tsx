import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SETTINGS_BOOT_SCRIPT } from "@/lib/settings";

const SITE = "https://rotas.arqueirover.de";
const TITLE = "Planejador de Rotas";
const DESCRIPTION = "Planeja a melhor sequência de paradas de carro, com trânsito previsto, pausas, modo viagem e relatório em PDF.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  robots: { index: false, follow: false },
  openGraph: { type: "website", url: SITE, siteName: TITLE, title: TITLE, description: DESCRIPTION, locale: "pt_BR" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
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
