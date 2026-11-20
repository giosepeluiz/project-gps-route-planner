/**
 * Link compartilhável no formato de caminho: /r/início/fim/parada1/…
 * É a mesma página do planejador; a rota é lida e validada no navegador
 * (src/lib/share-link.ts), que depois limpa o endereço.
 *
 * Aqui só a prévia do link (WhatsApp, redes sociais): título e descrição
 * mudam conforme a rota do link, lida com a mesma validação.
 */
import type { Metadata } from "next";
import { parseSharedRoute } from "@/lib/share-link";

export { default } from "../../page";

export async function generateMetadata({ params }: { params: Promise<{ rota?: string[] }> }): Promise<Metadata> {
  const { rota = [] } = await params;
  const shared = parseSharedRoute("/r/" + rota.join("/"), "");
  if (!shared) return {};
  const stops = shared.items.filter((i) => i.kind === "stop").length;
  const breaks = shared.items.length - stops;
  const title = `Rota com ${stops} ${stops === 1 ? "parada" : "paradas"} · Planejador de Rotas`;
  const parts = [
    `${stops} ${stops === 1 ? "parada" : "paradas"}`,
    shared.end === "start" ? "ida e volta" : shared.end === "none" ? "termina na última parada" : "com destino final",
    ...(breaks > 0 ? [`${breaks} ${breaks === 1 ? "pausa" : "pausas"} para descanso`] : []),
    ...(shared.time ? [`${shared.time.mode === "depart" ? "saída" : "chegada"} em ${shared.time.at.slice(8, 10)}/${shared.time.at.slice(5, 7)} às ${shared.time.at.slice(11, 16)}`] : []),
  ];
  const description = `Abra para ver a rota no mapa, com a melhor ordem das paradas e o trânsito previsto: ${parts.join(" · ")}.`;
  // A miniatura é a mesma do site (o openGraph daqui substitui o da raiz, então ela é repetida).
  const images = [{ url: "/opengraph-image", width: 1200, height: 630 }];
  return {
    title,
    description,
    openGraph: { type: "website", siteName: "Planejador de Rotas", locale: "pt_BR", title, description, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
