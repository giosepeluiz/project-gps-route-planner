import { describe, expect, it } from "vitest";
import { isPlace } from "./route-state";
import { placeName } from "./types";

describe("nome da parada", () => {
  const place = { id: "a", label: "Rua das Flores 10, Lisboa", lat: 38.7, lng: -9.1, source: "address" as const, confidence: 1, dwellMinutes: 0 };

  it("usa o apelido quando há, senão o endereço", () => {
    expect(placeName(place)).toBe(place.label);
    expect(placeName({ ...place, alias: "Casa da Ana" })).toBe("Casa da Ana");
    expect(placeName({ ...place, alias: "   " })).toBe(place.label);
  });

  it("o apelido não atrapalha a leitura da rota guardada", () => {
    expect(isPlace({ ...place, alias: "Casa da Ana" })).toBe(true);
  });
});
