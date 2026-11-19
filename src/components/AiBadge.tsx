"use client";

import { useLocale } from "./I18nProvider";

/** Sigla da IA em cada idioma (AI em inglês, IA nos demais). */
export const aiAcronym = (locale: string) => (locale.startsWith("en") ? "AI" : "IA");

/**
 * Símbolo padrão de IA: estrelas + "IA"/"AI" num retângulo arredondado. Usado
 * como ícone em tudo que vem da IA (no app, no e-mail e nos relatórios).
 */
export default function AiBadge({ className = "" }: { className?: string }) {
  const locale = useLocale();
  return (
    <span
      role="img"
      aria-label={aiAcronym(locale)}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md bg-accent px-1.5 py-px text-2xs font-bold leading-4 tracking-wide text-on-ink ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor">
        <path d="M8 2.5l1.35 3.9a2 2 0 001.25 1.25L14.5 9l-3.9 1.35a2 2 0 00-1.25 1.25L8 15.5l-1.35-3.9a2 2 0 00-1.25-1.25L1.5 9l3.9-1.35a2 2 0 001.25-1.25z" />
        <path d="M15 11.5l.65 1.85a1 1 0 00.6.6l1.85.65-1.85.65a1 1 0 00-.6.6L15 17.7l-.65-1.85a1 1 0 00-.6-.6L11.9 14.6l1.85-.65a1 1 0 00.6-.6z" />
      </svg>
      <span aria-hidden="true">{aiAcronym(locale)}</span>
    </span>
  );
}
