import { describe, expect, it } from "vitest";
import { isLocalHost, pointAlong } from "./trip-sim";

describe("viagem de teste", () => {
  const path: [number, number][] = [
    [-9.14, 38.7],
    [-9.14, 38.71], // ~1.1 km para o norte
  ];
  it("anda pela linha e para no fim", () => {
    const mid = pointAlong(path, 556);
    expect(mid.lat).toBeCloseTo(38.705, 3);
    expect(mid.heading).toBeCloseTo(0, 0);
    expect(mid.atEnd).toBe(false);
    expect(pointAlong(path, 5000)).toMatchObject({ lat: 38.71, atEnd: true });
  });
  it("só aparece no acesso local", () => {
    for (const host of ["localhost", "127.0.0.1", "app.localhost", "192.168.1.149", "10.0.0.5", "172.20.1.2"]) expect(isLocalHost(host)).toBe(true);
    for (const host of ["rotas.arqueirover.de", "172.32.0.1", "8.8.8.8"]) expect(isLocalHost(host)).toBe(false);
  });
});
