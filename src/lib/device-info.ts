/**
 * Dados técnicos do aparelho para as estatísticas anônimas: modelo (quando o
 * navegador informa), sistema, navegador e tela. Nada que identifique a pessoa.
 */
import type { TripReport } from "./trip-report";

/** Deixa só os caracteres aceitos pelo servidor (sem <, >, aspas, & ou quebras de linha). */
export const cleanTech = (text: string | undefined | null) =>
  (text ?? "").replace(/[^\p{L}\p{N} ._\-()+,/;:]/gu, "").trim().slice(0, 60);

interface UAData {
  brands?: { brand: string; version: string }[];
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string }>;
}

/** Navegador a partir do User-Agent (só nome e versão principal). */
function browserOf(ua: string, data: UAData | undefined): string {
  const brand = data?.brands?.find((b) => !/not.?a.?brand|chromium/i.test(b.brand));
  if (brand) return `${brand.brand} ${brand.version}`;
  const known = [/(Edg|OPR|SamsungBrowser|Firefox|FxiOS|CriOS|Chrome|Version)\/(\d+)/];
  for (const re of known) {
    const m = re.exec(ua);
    if (m) return `${m[1] === "Version" ? "Safari" : m[1]} ${m[2]}`;
  }
  return "";
}

function platformOf(ua: string, data: UAData | undefined, version: string | undefined): string {
  const android = /Android ([\d.]+)/.exec(ua);
  if (android) return `Android ${android[1]}`;
  const ios = /OS (\d+[_\d]*) like Mac OS X/.exec(ua);
  if (ios) return `iOS ${ios[1].replace(/_/g, ".")}`;
  return [data?.platform, version].filter(Boolean).join(" ");
}

/** Modelo do Android vem do User-Agent (ou do Client Hints, no Chrome). */
function modelOf(ua: string, hinted: string | undefined): string {
  if (hinted) return hinted;
  const m = /Android [\d.]+; ([^;)]+)/.exec(ua);
  if (m && !/^K$/.test(m[1])) return m[1];
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  return "";
}

export async function collectDevice(
  theme: "light" | "dark",
  fontSize: TripReport["device"]["fontSize"],
): Promise<TripReport["device"]> {
  const ua = navigator.userAgent;
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  let hints: { model?: string; platformVersion?: string } = {};
  try {
    hints = (await data?.getHighEntropyValues?.(["model", "platformVersion"])) ?? {};
  } catch {
    // Navegador sem Client Hints: fica com o User-Agent.
  }
  const orientation = screen.orientation?.type ?? "";
  return {
    model: cleanTech(modelOf(ua, hints.model)),
    platform: cleanTech(platformOf(ua, data, hints.platformVersion)),
    browser: cleanTech(browserOf(ua, data)),
    screen: `${Math.round(screen.width)}x${Math.round(screen.height)}`,
    viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
    pixelRatio: Math.min(10, Math.max(0.5, Math.round(window.devicePixelRatio * 100) / 100)),
    touch: navigator.maxTouchPoints > 0,
    orientation: orientation.startsWith("portrait") ? "portrait" : orientation.startsWith("landscape") ? "landscape" : "unknown",
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    theme,
    fontSize,
  };
}
