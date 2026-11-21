import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const req = (method: string, origin?: string) =>
  new NextRequest("https://rotas.arqueirover.de/api/status", { method, headers: origin ? { origin } : {} });

describe("CORS dos apps", () => {
  it("libera só as origens dos apps nativos", async () => {
    const ok = proxy(req("OPTIONS", "https://localhost"));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(proxy(req("OPTIONS", "https://site-malicioso.com")).status).toBe(403);
    expect(proxy(req("GET", "https://site-malicioso.com")).headers.get("access-control-allow-origin")).toBeNull();
    expect(proxy(req("GET", "http://tauri.localhost")).headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
  });
});
