import RoutePlanner from "@/components/RoutePlanner";
import { getFallbackStyleUrl } from "@/lib/map-style";

export default function Home() {
  // Com senha configurada, as Configurações mostram o botão "Sair".
  const authEnabled = Boolean(process.env.APP_PASSWORD?.trim());
  return <RoutePlanner fallbackStyleUrl={getFallbackStyleUrl()} authEnabled={authEnabled} />;
}
