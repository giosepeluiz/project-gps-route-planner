/** Idiomas da interface. */
export const LOCALES = ["pt-BR", "pt-PT", "en-GB", "es-ES"] as const;
export type Locale = (typeof LOCALES)[number];

/** "system" segue o idioma do aparelho. */
export type LanguageChoice = "system" | Locale;

/** Idioma usado no HTML do servidor e quando nada combina. */
export const DEFAULT_LOCALE: Locale = "pt-BR";

/** Nome de cada idioma no próprio idioma (assim cada um reconhece o seu). */
export const LOCALE_NAMES: Record<Locale, string> = {
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  "en-GB": "English (UK)",
  "es-ES": "Español",
};

/** Países em que se escreve o português europeu. */
const EUROPEAN_PORTUGUESE = new Set(["PT", "AO", "MZ", "CV", "GW", "ST", "TL", "MO"]);

/** Converte uma etiqueta do navegador ("pt-PT", "en-US", "es") num dos idiomas do app. */
export function matchLocale(tag: string): Locale | null {
  const [language, region] = tag.replace("_", "-").split("-");
  const lang = language?.toLowerCase();
  const reg = region?.toUpperCase();
  if (lang === "pt") return reg && EUROPEAN_PORTUGUESE.has(reg) ? "pt-PT" : "pt-BR";
  if (lang === "en") return "en-GB";
  if (lang === "es") return "es-ES";
  return null;
}

/**
 * Idioma efetivo: a escolha das configurações ou, em "Sistema", o primeiro
 * idioma do aparelho que o app conhece. Sem nenhum conhecido, inglês.
 */
export function resolveLocale(choice: LanguageChoice, systemLanguages: readonly string[]): Locale {
  if (choice !== "system") return choice;
  for (const tag of systemLanguages) {
    const found = matchLocale(tag);
    if (found) return found;
  }
  return systemLanguages.length === 0 ? DEFAULT_LOCALE : "en-GB";
}

export const isLanguageChoice = (value: unknown): value is LanguageChoice =>
  value === "system" || LOCALES.includes(value as Locale);
