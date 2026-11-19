import { describe, expect, it } from "vitest";
import { departureReportHtml, finalReportHtml } from "./pdf-report";

const common = {
  version: "0.6.0",
  generatedAt: new Date("2026-11-20T09:00:00"),
  mapImage: null,
  logoUrl: "https://x/logo.png",
  startName: "Casa <b>",
  endName: null,
  roundTrip: true,
};
const rows = [
  { n: "1", name: "Mercado", arriveAt: new Date("2026-11-20T10:10:00"), dwellSeconds: 600, leaveAt: new Date("2026-11-20T10:20:00"), legSeconds: 600, legMeters: 5000, breakSeconds: 0 },
  { n: "↺", name: "Casa", arriveAt: new Date("2026-11-20T10:40:00"), dwellSeconds: 0, leaveAt: null, legSeconds: 1200, legMeters: 9000, breakSeconds: 0 },
];

describe("relatórios em PDF", () => {
  it("relatório de saída: idioma, autor, versão, IA marcada e texto escapado", () => {
    const html = departureReportHtml({
      ...common, locale: "en-GB", departAt: new Date("2026-11-20T10:00:00"), arriveAt: new Date("2026-11-20T10:40:00"),
      totalSeconds: 2400, driveSeconds: 1800, dwellSeconds: 600, breakSeconds: 0, totalMeters: 14000, rows, aiComment: "<script>x</script>",
    });
    expect(html).toContain("Departure report");
    expect(html).toContain("Giosepe Luiz dos Santos");
    expect(html).toContain("0.6.0");
    expect(html).toContain('class="ai"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Casa <b>");
  });
  it("relatório final: comparação, gráficos e análise", () => {
    const trip = {
      plannedSeconds: 1800, actualSeconds: 2400, plannedMeters: 14000, actualMeters: 15000, stoppedSeconds: 600, averageKmh: 45,
      stopsPlanned: 1, stopsDone: 1, roundTrip: true, hasEnd: true, pausesUsed: 1, pausedSeconds: 120, longStillCount: 0, longStillSeconds: 0,
      restBreaks: 0, restBreakMinutes: 0, reroutes: 2, headingUp: true, averageGpsAccuracyM: 10,
      legs: [
        { plannedSeconds: 600, actualSeconds: 700, plannedMeters: 5000, plannedDwellSeconds: 600, actualDwellSeconds: 500, restBreak: false },
        { plannedSeconds: 1200, actualSeconds: 1500, plannedMeters: 9000, plannedDwellSeconds: 0, actualDwellSeconds: 0, restBreak: false },
      ],
    };
    const html = finalReportHtml({
      ...common, locale: "pt-BR", trip, rows,
      summary: { plannedSeconds: 1800, actualSeconds: 2400, plannedArriveAt: null, arrivedAt: 0, plannedMeters: 14000, actualMeters: 15000, stoppedSeconds: 600, averageKmh: 45, stopsDone: 1 },
      analysis: { verdict: "poor", summary: "Resumo", findings: [{ level: "bad", title: "T", detail: "D" }] },
    });
    expect(html).toContain("Relatório final da viagem");
    expect(html).toContain("<svg viewBox=\"0 0 420");
    expect(html).toContain("Desvios grandes");
    expect(html).toContain("+33%");
  });
});
