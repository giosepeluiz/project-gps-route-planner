import { describe, expect, it } from "vitest";
import { detectPlatform, formatSize, releaseFromGitHub } from "./app-download";

describe("sistema do aparelho", () => {
  it("reconhece cada sistema", () => {
    expect(detectPlatform({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130", platform: "Windows" })).toBe("windows");
    expect(detectPlatform({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", platform: "MacIntel" })).toBe("mac");
    expect(detectPlatform({ ua: "Mozilla/5.0 (X11; Linux x86_64) Firefox/130", platform: "Linux x86_64" })).toBe("linux");
    expect(detectPlatform({ ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile", platform: "Linux armv8l" })).toBe("android");
    expect(detectPlatform({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe("ios");
    expect(detectPlatform({ ua: "Mozilla/5.0 (X11; CrOS x86_64)" })).toBe("other");
  });

  it("iPad que se apresenta como Mac conta como iOS", () => {
    expect(detectPlatform({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe("ios");
  });
});

describe("release do app", () => {
  const asset = (name: string) => ({ name, browser_download_url: `https://x/${name}`, size: 52_428_800 });

  it("separa os arquivos por sistema", () => {
    const release = releaseFromGitHub({
      tag_name: "v0.4.1",
      html_url: "https://github.com/x/releases/tag/v0.4.1",
      assets: [
        asset("Routes-Planner-0.4.1-beta-android.apk"),
        asset("Routes-Planner-0.4.1-beta-linux.AppImage"),
        asset("Routes-Planner-0.4.1-beta-windows-portable.exe"),
        asset("Routes-Planner-0.4.1-beta-windows-setup.exe"),
      ],
    })!;
    expect(release.version).toBe("0.4.1");
    expect(release.windows?.name).toContain("setup");
    expect(release.windowsPortable?.name).toContain("portable");
    expect(release.linux?.name).toContain("AppImage");
    expect(release.android?.name).toContain("apk");
    expect(release.mac).toBeUndefined();
  });

  it("sem tag, não há release", () => {
    expect(releaseFromGitHub({})).toBeNull();
  });

  it("mostra o tamanho em MB", () => {
    expect(formatSize(52_428_800)).toBe("50 MB");
    expect(formatSize(5_242_880)).toBe("5.0 MB");
  });
});
