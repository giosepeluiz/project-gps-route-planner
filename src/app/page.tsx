import RoutePlanner from "@/components/RoutePlanner";
import { getFallbackStyleUrl } from "@/lib/map-style";

export default function Home() {
  return <RoutePlanner fallbackStyleUrl={getFallbackStyleUrl()} />;
}
