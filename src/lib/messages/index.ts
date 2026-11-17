import type { Locale } from "../i18n";
import enGB from "./en-GB";
import esES from "./es-ES";
import ptBR, { type Messages } from "./pt-BR";
import ptPT from "./pt-PT";

export type { Messages };

export const MESSAGES: Record<Locale, Messages> = {
  "pt-BR": ptBR,
  "pt-PT": ptPT,
  "en-GB": enGB,
  "es-ES": esES,
};
