/** Origem de um local informado pelo usuário. */
export type PlaceSource = "address" | "pin" | "coords" | "link";

export interface Place {
  id: string;
  label: string;
  lat: number;
  lng: number;
  source: PlaceSource;
  /** Confiança da leitura do local, de 0 a 1. */
  confidence: number;
  /** Tempo de permanência na parada. Reservado para uso futuro (sem interface). */
  dwellMinutes: number;
}

/** "Sair em" (depart) ou "Chegar até" (arrive). */
export type TimeMode = "depart" | "arrive";

export interface PlanLeg {
  from: Place;
  to: Place;
  seconds: number;
  arriveAt: Date;
  /** true quando o tempo veio da estimativa por distância. */
  estimated: boolean;
}

export interface Plan {
  legs: PlanLeg[];
  totalSeconds: number;
  departAt: Date;
  arriveAt: Date;
  hasEstimates: boolean;
}

export interface LegTime {
  seconds: number;
  estimated: boolean;
}

export type LegTimeFn = (from: Place, to: Place) => LegTime;
