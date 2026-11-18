import { describe, expect, it, vi } from "vitest";
import { cleanTech } from "./device-info";
import { createResendMailer, mailerFromEnv } from "./server/mailer";
import { readJsonLimited } from "./server/read-json";
import type { TripSummary } from "./trip";
import { reportText, TripReport, TripReportRequest } from "./trip-report";
import { newTrack, trackArrive, trackFix, trackLeave, trackPause, trackResume, tripReportOf } from "./trip-track";

const fix = (lat: number, lng: number, at: number, accuracy = 10) => ({ lat, lng, at, accuracy });

const summary: TripSummary = {
  plannedSeconds: 1800,
  actualSeconds: 2100,
  plannedArriveAt: 0,
  arrivedAt: 0,
  plannedMeters: 20_000,
  actualMeters: 21_500,
  stoppedSeconds: 600,
  averageKmh: 51.6,
  stopsDone: 1,
};

function sampleReport(): TripReport {
  let track = newTrack(0);
  track = trackFix(track, fix(38.7, -9.14, 0));
  track = trackFix(track, fix(38.70001, -9.14, 6 * 60_000)); // parado 6 min sem pausar
  track = trackFix(track, fix(38.72, -9.14, 7 * 60_000));
  track = trackArrive(track, 10 * 60_000);
  track = trackLeave(track, 15 * 60_000);
  track = trackPause(track, 20 * 60_000);
  track = trackResume(track, 22 * 60_000);
  const trip = tripReportOf(
    track,
    summary,
    [
      { seconds: 540, meters: 9000, dwellSeconds: 300, restBreak: false },
      { seconds: 900, meters: 11_000, dwellSeconds: 0, restBreak: true },
    ],
    { stopsPlanned: 1, roundTrip: false, hasEnd: true, restBreaks: 1, restBreakMinutes: 15, headingUp: true },
    35 * 60_000,
  );
  return {
    appVersion: "0.4.0",
    locale: "pt-BR",
    trip,
    device: {
      model: "Pixel 8",
      platform: "Android 15",
      browser: "Chrome 142",
      screen: "412x915",
      viewport: "412x839",
      pixelRatio: 2.63,
      touch: true,
      orientation: "portrait",
      standalone: false,
      theme: "dark",
      fontSize: "sm",
    },
  };
}

describe("registro da viagem", () => {
  it("conta trechos, permanência, pausas e paradas longas sem pausar", () => {
    const report = sampleReport();
    const t = report.trip;
    expect(t.longStillCount).toBe(1);
    expect(t.longStillSeconds).toBe(360);
    expect(t.pausesUsed).toBe(1);
    expect(t.pausedSeconds).toBe(120);
    expect(t.legs[0]).toEqual({
      plannedSeconds: 540,
      actualSeconds: 600,
      plannedMeters: 9000,
      plannedDwellSeconds: 300,
      actualDwellSeconds: 300,
      restBreak: false,
    });
    expect(t.legs[1].restBreak).toBe(true);
    expect(t.averageGpsAccuracyM).toBe(10);
    expect(TripReport.safeParse(report).success).toBe(true);
  });
});

describe("estatísticas anônimas: validação contra injeção", () => {
  it("aceita o relatório normal e recusa campos a mais", () => {
    expect(TripReportRequest.safeParse({ report: sampleReport(), copyTo: null }).success).toBe(true);
    const extra = { ...sampleReport(), lat: 38.7 };
    expect(TripReport.safeParse(extra).success).toBe(false);
    const extraTrip = sampleReport();
    (extraTrip.trip as Record<string, unknown>).label = "Casa";
    expect(TripReport.safeParse(extraTrip).success).toBe(false);
  });

  it("recusa HTML, aspas e quebras de linha nos textos do aparelho", () => {
    for (const model of ['<img src=x onerror="alert(1)">', "Pixel\r\nBcc: a@b.c", 'a"b', "a&b", "x".repeat(61)]) {
      const report = sampleReport();
      report.device.model = model;
      expect(TripReport.safeParse(report).success).toBe(false);
    }
    expect(cleanTech('<b>Pixel 8</b>\r\n"x"&')).toBe("bPixel 8/bx");
  });

  it("recusa e-mail de cópia inválido ou com cabeçalho forjado", () => {
    for (const copyTo of ["nao-e-email", "a@b.c\r\nBcc: x@y.z", "a@b.c, d@e.f", `${"a".repeat(250)}@b.cc`]) {
      expect(TripReportRequest.safeParse({ report: sampleReport(), copyTo }).success).toBe(false);
    }
    expect(TripReportRequest.safeParse({ report: sampleReport(), copyTo: "pessoa@exemplo.com" }).success).toBe(true);
  });

  it("o texto do e-mail é puro, sem localização nem nomes", () => {
    const text = reportText(sampleReport());
    expect(text).toContain("Tempo: previsto 30 min · real 35 min");
    expect(text).toContain("Parado mais de 5 min no mesmo lugar sem pausar: 1 vez(es), 6 min");
    expect(text).not.toMatch(/38\.7|-9\.14|<|>/);
  });
});

describe("envio do e-mail", () => {
  it("manda só texto, para o autor, com a cópia em CC", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    const mailer = createResendMailer("re_test", "Planejador <rotas@arqueirover.de>", "rotas@arqueirover.de", fetchFn);
    expect(await mailer.send({ subject: "S", text: "corpo", cc: "pessoa@exemplo.com" })).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      from: "Planejador <rotas@arqueirover.de>",
      to: ["rotas@arqueirover.de"],
      cc: ["pessoa@exemplo.com"],
      subject: "S",
      text: "corpo",
    });
    expect(body).not.toHaveProperty("html");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
  });

  it("falha do provedor vira false, sem nova tentativa (nada de e-mail repetido)", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 500 }));
    const mailer = createResendMailer("re_test", "a@b.c", "c@d.e", fetchFn);
    expect(await mailer.send({ subject: "S", text: "t", cc: null })).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sem chave ou remetente, o envio fica desligado", () => {
    expect(mailerFromEnv({})).toBeNull();
    expect(mailerFromEnv({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(mailerFromEnv({ RESEND_API_KEY: "re_x", REPORT_EMAIL_FROM: "a@b.c" })).not.toBeNull();
  });
});

describe("corpo dos POSTs com limite", () => {
  const request = (body: string, type = "application/json") =>
    new Request("http://x/api", { method: "POST", headers: { "content-type": type }, body });

  it("lê JSON pequeno e recusa o grande, o inválido e o que não é JSON", async () => {
    expect(await readJsonLimited(request('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJsonLimited(request(`{"a":"${"x".repeat(200)}"}`), 100)).toEqual({ ok: false, status: 413 });
    expect(await readJsonLimited(request("{"), 100)).toEqual({ ok: false, status: 400 });
    expect(await readJsonLimited(request('{"a":1}', "text/plain"), 100)).toEqual({ ok: false, status: 415 });
  });
});
