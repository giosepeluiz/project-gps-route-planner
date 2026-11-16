import { estimateSeconds } from "./geo";
import type { LegTimeFn, Place } from "./types";

/**
 * Dados fictícios da fase 1, baseados nos fixtures reais da TomTom
 * (terça-feira 2026-11-17, 09:00). Somem quando os provedores entrarem (fase 4).
 */
function fixture(id: string, label: string, lat: number, lng: number): Place {
  return { id, label, lat, lng, source: "coords", confidence: 1, dwellMinutes: 0 };
}

export const FIXTURE_PLACES = {
  B: fixture("B", "Barreiro", 38.661328, -9.0758545),
  Be: fixture("Be", "Belém", 38.6967497, -9.2147201),
  PN: fixture("PN", "Parque das Nações", 38.7738904, -9.0941674),
  CC: fixture("CC", "Costa da Caparica", 38.6421751, -9.2315575),
  PC: fixture("PC", "Praça do Comércio", 38.707432, -9.1372925),
  Bf: fixture("Bf", "Benfica (Colombo)", 38.7511813, -9.2021464),
} as const;

/** Tempos de carro em segundos. Cada par foi medido em um só sentido. */
export const FIXTURE_SECONDS: Record<"t0900" | "t1800", Record<string, Record<string, number>>> = {
  t0900: {
    B: { Be: 3049, PN: 2585, CC: 2012, PC: 3409, Bf: 3041 },
    Be: { PN: 1894, CC: 1493, PC: 1170, Bf: 810 },
    PN: { CC: 2464, PC: 1815, Bf: 1608 },
    CC: { PC: 2469, Bf: 2178 },
    PC: { Bf: 1443 },
  },
  t1800: {
    B: { Be: 2605, PN: 2409, CC: 2002, PC: 2961, Bf: 2901 },
    Be: { PN: 1998, CC: 1895, PC: 1188, Bf: 1074 },
    PN: { CC: 3052, PC: 1549, Bf: 1911 },
    CC: { PC: 1895, Bf: 1848 },
    PC: { Bf: 1967 },
  },
};

/** Consulta simétrica nos fixtures (válido APENAS para estes dados). */
export function fixtureSeconds(
  slot: "t0900" | "t1800",
  fromId: string,
  toId: string,
): number | undefined {
  const table = FIXTURE_SECONDS[slot];
  return table[fromId]?.[toId] ?? table[toId]?.[fromId];
}

/** Tempo fictício: fixture das 09:00 quando existir, senão estimativa por distância. */
export const mockLegTime: LegTimeFn = (from, to) => {
  if (from.id === to.id) return { seconds: 0, estimated: false };
  const known = fixtureSeconds("t0900", from.id, to.id);
  if (known !== undefined) return { seconds: known, estimated: false };
  return { seconds: estimateSeconds(from, to), estimated: true };
};

export const MOCK_START = FIXTURE_PLACES.B;
/** Ordem em que as paradas foram "digitadas". */
export const MOCK_TYPED_STOPS: Place[] = [FIXTURE_PLACES.Be, FIXTURE_PLACES.PN, FIXTURE_PLACES.CC];
/** Ordem ótima conhecida para o ciclo com início e fim no Barreiro. */
export const MOCK_ORDERED_STOPS: Place[] = [FIXTURE_PLACES.CC, FIXTURE_PLACES.Be, FIXTURE_PLACES.PN];
