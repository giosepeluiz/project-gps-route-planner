"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_LOCALE, resolveLocale, type LanguageChoice, type Locale } from "@/lib/i18n";
import { MESSAGES, type Messages } from "@/lib/messages";

interface I18n {
  locale: Locale;
  t: Messages;
}

const I18nContext = createContext<I18n>({ locale: DEFAULT_LOCALE, t: MESSAGES[DEFAULT_LOCALE] });

const subscribeLanguages = (onChange: () => void) => {
  window.addEventListener("languagechange", onChange);
  return () => window.removeEventListener("languagechange", onChange);
};
const readLanguages = () => (navigator.languages?.length ? navigator.languages : [navigator.language]).join(",");

/**
 * Idioma efetivo. No servidor (e na hidratação) vale o padrão; logo depois, no
 * navegador, entra o idioma escolhido ou o do aparelho.
 */
export function useResolvedLocale(choice: LanguageChoice): Locale {
  const languages = useSyncExternalStore(subscribeLanguages, readLanguages, () => "");
  return languages ? resolveLocale(choice, languages.split(",")) : DEFAULT_LOCALE;
}

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, t: MESSAGES[locale] }}>{children}</I18nContext.Provider>;
}

/** Textos no idioma atual. */
export const useT = () => useContext(I18nContext).t;
export const useLocale = () => useContext(I18nContext).locale;
