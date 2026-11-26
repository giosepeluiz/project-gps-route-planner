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
  /** Tempo de permanência na parada, em minutos (0 = só passa). Início e fim ficam em 0. */
  dwellMinutes: number;
  /** Nome dado pela pessoa (renomear a parada). Vazio = vale o endereço (label). */
  alias?: string;
}

/** Nome mostrado de um local: o apelido, se houver, ou o endereço. */
export const placeName = (place: { label: string; alias?: string }): string =>
  place.alias?.trim() || place.label;

/** Tamanho máximo do apelido de uma parada. */
export const MAX_ALIAS_LENGTH = 80;

/** Limite do tempo de permanência numa parada (12 h). */
export const MAX_DWELL_MINUTES = 720;

/** "Sair em" (depart) ou "Chegar até" (arrive). */
export type TimeMode = "depart" | "arrive";

export interface PlanLeg {
  from: Place;
  to: Place;
  seconds: number;
  arriveAt: Date;
  /** Tempo parado no destino do trecho (permanência). */
  dwellSeconds: number;
  /** Saída do destino do trecho: chegada + permanência. */
  leaveAt: Date;
  /** Pausa para descanso no caminho deste trecho (já somada à chegada). */
  breakSeconds: number;
  /** Espera até o horário obrigatório da parada (chegou antes). */
  waitSeconds: number;
  /** true quando o tempo veio da estimativa por distância. */
  estimated: boolean;
}

export interface Plan {
  legs: PlanLeg[];
  /** Duração total: direção + permanência nas paradas. */
  totalSeconds: number;
  /** Só o tempo dirigindo. */
  driveSeconds: number;
  /** Soma da permanência nas paradas. */
  dwellSeconds: number;
  /** Soma das pausas para descanso. */
  breakSeconds: number;
  departAt: Date;
  arriveAt: Date;
  hasEstimates: boolean;
}

export interface LegTime {
  seconds: number;
  estimated: boolean;
}

export type LegTimeFn = (from: Place, to: Place) => LegTime;
