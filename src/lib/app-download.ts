/** Sistema do aparelho e arquivos de download do app (releases do GitHub). */

export type Platform = "windows" | "mac" | "linux" | "android" | "ios" | "other";

/** Repositório dos aplicativos (instaladores nas Releases). */
export const APP_REPO = "giosepeluiz/project-gps-route-planner-app";
export const APP_RELEASES_URL = `https://github.com/${APP_REPO}/releases`;

export interface DownloadFile {
  url: string;
  name: string;
  /** Tamanho em bytes. */
  size: number;
}

export interface AppRelease {
  /** Versão sem o "v" (ex.: 0.4.1). */
  version: string;
  /** Página da release. */
  url: string;
  windows?: DownloadFile;
  windowsPortable?: DownloadFile;
  mac?: DownloadFile;
  linux?: DownloadFile;
  android?: DownloadFile;
}

/** Descobre o sistema a partir do User-Agent (e de dicas do navegador, quando há). */
export function detectPlatform(input: { ua: string; platform?: string; maxTouchPoints?: number }): Platform {
  const { ua, platform = "", maxTouchPoints = 0 } = input;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS se apresenta como Mac, mas tem tela de toque.
  if (/Mac/i.test(platform || ua) && maxTouchPoints > 1) return "ios";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/CrOS/i.test(ua)) return "other";
  if (/Linux|X11/i.test(platform) || /Linux|X11/i.test(ua)) return "linux";
  return "other";
}

/** Sistema do aparelho atual (só no navegador). */
export function currentPlatform(): Platform {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return detectPlatform({
    ua: navigator.userAgent,
    platform: data?.platform || navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

/** true dentro do próprio app (Tauri ou Capacitor): lá não há o que promover. */
export function isInsideApp(): boolean {
  const w = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return !!w.__TAURI__ || !!w.__TAURI_INTERNALS__ || !!w.Capacitor?.isNativePlatform?.();
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/** Escolhe, entre os arquivos da release, o de cada sistema. */
export function releaseFromGitHub(data: {
  tag_name?: string;
  html_url?: string;
  assets?: GitHubAsset[];
}): AppRelease | null {
  if (!data.tag_name) return null;
  const file = (a: GitHubAsset | undefined): DownloadFile | undefined =>
    a ? { url: a.browser_download_url, name: a.name, size: a.size } : undefined;
  const assets = data.assets ?? [];
  const find = (re: RegExp) => assets.find((a) => re.test(a.name));
  return {
    version: data.tag_name.replace(/^v/i, ""),
    url: data.html_url ?? APP_RELEASES_URL,
    windows: file(find(/windows.*setup.*\.(exe|msi)$/i) ?? find(/\.msi$/i)),
    windowsPortable: file(find(/windows.*portable.*\.exe$/i)),
    mac: file(find(/\.dmg$/i) ?? find(/mac(os)?.*\.(zip|pkg)$/i)),
    linux: file(find(/\.AppImage$/i) ?? find(/\.deb$/i)),
    android: file(find(/\.apk$/i)),
  };
}

/** "78 MB". */
export function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
