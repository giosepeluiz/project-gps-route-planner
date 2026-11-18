import { describe, expect, it } from "vitest";
import { deviation, esc, reportHtml, reportSubject, reportText, type TripAnalysis } from "./report-email";
import { TripAnalysisSchema } from "./server/trip-analysis";
import type { TripReport } from "./trip-report";

const report = (locale: TripReport["locale"] = "pt-BR"): TripReport => ({
  appVersion: "0.5.0",
  locale,
  trip: {
    plannedSeconds: 1800, actualSeconds: 2400, plannedMeters: 20_000, actualMeters: 21_000, stoppedSeconds: 300,
    averageKmh: 48, stopsPlanned: 2, stopsDone: 2, roundTrip: false, hasEnd: true, pausesUsed: 0, pausedSeconds: 0,
    longStillCount: 0, longStillSeconds: 0, restBreaks: 0, restBreakMinutes: 0, reroutes: 1, headingUp: true,
    averageGpsAccuracyM: 12,
    legs: [{ plannedSeconds: 900, actualSeconds: 1000, plannedMeters: 10_000, plannedDwellSeconds: 300, actualDwellSeconds: 360, restBreak: true }],
  },
  device: {
    model: "Pixel 8", platform: "Android 15", browser: "Chrome 140", screen: "412x915", viewport: "412x800",
    pixelRatio: 2.6, touch: true, orientation: "portrait", standalone: false, theme: "dark", fontSize: "md",
  },
});

describe("e-mail das estatísticas", () => {
  it("vai no idioma do app", () => {
    expect(reportSubject(report("en-GB"))).toBe("Trip statistics · Route Planner 0.5.0");
    expect(reportText(report("en-GB"))).toContain("Time: planned 30 min · actual 40 min");
    expect(reportHtml(report("es-ES"), null, "https://x/logo.png")).toContain("Planificador de Rutas");
    expect(reportHtml(report("pt-PT"), null, "https://x/logo.png")).toContain("Planeador de Rotas");
  });

  it("colore o desvio: até 10% verde, até 25% âmbar, acima vermelho; mais rápido é bom", () => {
    expect(deviation(100, 105)?.tone).toBe("good");
    expect(deviation(100, 120)?.tone).toBe("warn");
    expect(deviation(100, 140)?.tone).toBe("bad");
    expect(deviation(100, 60)?.tone).toBe("good");
    expect(deviation(100, 60, false)?.tone).toBe("bad");
    expect(deviation(null, 60)).toBeNull();
  });

  it("escapa todo texto da IA no HTML", () => {
    const analysis: TripAnalysis = {
      verdict: "poor",
      summary: `<script>alert(1)</script> "x" & 'y'`,
      findings: [{ level: "bad", title: "<img src=x onerror=1>", detail: "ok" }],
    };
    const html = reportHtml(report(), analysis, `https://x/"onload="1`);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain(`"onload="1`);
    expect(esc(`<a href="x">`)).toBe("&lt;a href=&quot;x&quot;&gt;");
    expect(reportText(report(), analysis)).toContain("Desvios grandes.");
  });

  it("a resposta da IA é conferida e limpa", () => {
    const ok = TripAnalysisSchema.parse({
      verdict: "fair",
      summary: "Resumo <b>com</b> tags",
      findings: [{ level: "warn", title: "Título", detail: "Detalhe" }],
    });
    expect(ok.summary).not.toMatch(/[<>]/);
    expect(TripAnalysisSchema.safeParse({ verdict: "meh", summary: "abc", findings: [] }).success).toBe(false);
  });
});
