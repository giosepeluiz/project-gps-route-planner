"use client";

import { apiUrl } from "@/lib/api-base";
import { useEffect, useRef, useState, type ReactNode } from "react";
import pkg from "../../package.json";
import { useLocale, useT } from "./I18nProvider";
import { LOCALE_NAMES } from "@/lib/i18n";
import type { Messages } from "@/lib/messages";
import type { ServiceStatus } from "@/lib/server/services";
import { FONT_PX, type Settings } from "@/lib/settings";
import { MAX_STOPS } from "@/lib/stops";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  /** Tema em uso (o "Sistema" já resolvido). */
  theme: "light" | "dark";
  onNotify: (text: string) => void;
}

const AUTHOR = "Giosepe Luiz dos Santos";
const collaboration = (and: string) => `Anthropic Claude Fable 5.2 ${and} Opus 5.5`;

const CONTACTS = [
  { name: "Instagram", handle: "@giosepeluiz", href: "https://instagram.com/giosepeluiz" },
  { name: "GitHub", handle: "giosepeluiz", href: "https://github.com/giosepeluiz" },
  { name: "Facebook", handle: "giosepeluiz", href: "https://facebook.com/giosepeluiz" },
  { name: "email", handle: "contato@arqueirover.de", href: "mailto:contato@arqueirover.de" },
];

/** Até a versão 1.0 o app é beta. */
export const IS_BETA = Number(pkg.version.split(".")[0]) < 1;

/** Versão sem o ^ / ~ do package.json. */
const ver = (range: string | undefined) => (range ?? "?").replace(/^[\^~]/, "");

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-5 pt-5">
      <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.06em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

type State = keyof Messages["about"]["states"];

function StateTag({ state }: { state: State }) {
  const t = useT();
  const tone =
    state === "on" || state === "always"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : state === "dev"
        ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-sunken text-muted";
  return <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-semibold ${tone}`}>{t.about.states[state]}</span>;
}

/** Uma linha da lista de serviços: o quê, para quê e se está ligado. */
function Service({ name, role, state, href }: { name: string; role: string; state: State; href?: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {name}
            </a>
          ) : (
            name
          )}
        </p>
        <p className="text-xs text-muted">{role}</p>
      </div>
      <StateTag state={state} />
    </li>
  );
}

/** Tela Sobre: autoria, contatos, serviços, IA e informações técnicas. */
export default function AboutDialog({ open, onClose, settings, theme, onNotify }: AboutDialogProps) {
  const t = useT();
  const locale = useLocale();
  const a = t.about;
  const ref = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const versionLabel = `${pkg.version}${IS_BETA ? ` (${a.betaLabel})` : ""}`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // O que está ligado no servidor (só booleanos e modelos), buscado ao abrir.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(apiUrl("/api/status"), { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ServiceStatus>) : null))
      .then((data) => data && setStatus(data))
      .catch(() => {});
    return () => controller.abort();
  }, [open]);

  const s = (flag: boolean | undefined): State => (status === null ? "unknown" : flag ? "on" : "off");
  const deps = pkg.dependencies as Record<string, string>;
  const devDeps = pkg.devDependencies as Record<string, string>;
  const model = (name: string, info: { model: string; enabled: boolean } | undefined) =>
    info ? `${name} ${info.model}${info.enabled ? "" : ` (${a.tech.noKey})`}` : "…";

  const technical: [string, string][] = [
    [a.tech.app, `${t.app.title} ${versionLabel}`],
    [a.tech.framework, `Next.js ${ver(deps.next)} (App Router) · React ${ver(deps.react)}`],
    [a.tech.map, `MapLibre GL JS ${ver(deps["maplibre-gl"])} · OpenFreeMap Liberty`],
    [a.tech.ui, `Tailwind CSS ${ver(devDeps.tailwindcss)} · TypeScript ${ver(devDeps.typescript)}`],
    [a.tech.validation, `zod ${ver(deps.zod)}`],
    [a.tech.tests, `Vitest ${ver(devDeps.vitest)}`],
    [a.tech.order, a.tech.orderValue],
    [a.tech.limit, a.tech.limitValue(MAX_STOPS)],
    [a.tech.resilience, a.tech.resilienceValue(!!status?.sharedCache)],
    [a.tech.rateLimit, a.tech.rateLimitValue(status?.rateLimitPerMinute ?? 60)],
    [a.tech.aiPrimary, model("Gemini", status?.gemini)],
    [a.tech.aiBackup, model("Groq", status?.groq)],
    [a.tech.language, LOCALE_NAMES[locale]],
    [a.tech.theme, a.tech.themeValue(theme === "dark")],
    [a.tech.fontSize, `${t.settings.fonts[settings.fontSize]} (${FONT_PX[settings.fontSize]} px)`],
    // Dados do navegador só com a tela aberta: no HTML do servidor eles não existem (e não podem divergir).
    ...(open
      ? ([
          [a.tech.browserLanguage, navigator.language],
          [a.tech.screen, a.tech.screenValue(window.innerWidth, window.innerHeight, window.devicePixelRatio)],
          [a.tech.browser, navigator.userAgent],
        ] as [string, string][])
      : []),
  ];

  const copyTechnical = () => {
    const text = [
      ...technical.map(([key, value]) => `${key}: ${value}`),
      `${a.developedBy} ${AUTHOR}${a.withHelp} ${collaboration(a.and)}.`,
    ].join("\n");
    void navigator.clipboard?.writeText(text).then(
      () => onNotify(a.technicalCopied),
      () => onNotify(t.common.copyFailed),
    );
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="sobre-titulo"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[min(48rem,calc(100dvh-2rem))] w-[min(34rem,calc(100vw-2rem))] lg:w-[min(42rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/40 open:flex open:flex-col max-md:h-dvh max-md:max-h-none max-md:w-full max-md:max-w-none max-md:rounded-none max-md:border-0"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 id="sobre-titulo" className="text-base font-semibold">
          {a.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-5">
        <div className="flex items-center gap-3.5 px-5 pt-5">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-white dark:text-[#10131c]">
            <svg viewBox="0 0 20 20" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="5" r="2" />
              <circle cx="15" cy="15" r="2" />
              <path d="M7 5h5.5a2.5 2.5 0 010 5h-5a2.5 2.5 0 000 5H13" />
            </svg>
          </span>
          <div>
            <p className="flex items-center gap-2 text-lg font-semibold leading-tight">
              {t.app.title}
              {IS_BETA && (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {a.beta}
                </span>
              )}
            </p>
            <p className="text-xs text-muted">{a.version(versionLabel)}</p>
          </div>
        </div>
        {IS_BETA && (
          <p className="mx-5 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {a.betaNote}
          </p>
        )}
        <p className="px-5 pt-3 text-sm leading-relaxed text-ink-2">{a.intro}</p>

        <Section title={a.authorship}>
          <p className="text-sm leading-relaxed text-ink">
            {a.developedBy} <strong className="font-semibold">{AUTHOR}</strong>
            {a.withHelp} <strong className="font-semibold">{collaboration(a.and)}</strong>.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
            {CONTACTS.map((contact) => (
              <li key={contact.name}>
                <a
                  href={contact.href}
                  target={contact.href.startsWith("mailto:") ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  className="focus-ring flex flex-col rounded-lg border border-line px-3 py-2 transition-colors hover:border-line-strong hover:bg-hover"
                >
                  <span className="text-2xs font-medium text-muted">{contact.name === "email" ? a.email : contact.name}</span>
                  <span className="truncate text-sm font-medium text-ink">{contact.handle}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={a.services}>
          <ul className="divide-y divide-line">
            <Service name="OpenFreeMap · OpenStreetMap" role={a.serviceRoles.map} state="always" href="https://openfreemap.org" />
            <Service name="Nominatim (OpenStreetMap)" role={a.serviceRoles.nominatim} state="always" href="https://nominatim.org" />
            <Service name="TomTom" role={a.serviceRoles.tomtom} state={s(status?.tomtom)} href="https://developer.tomtom.com" />
            <Service
              name="OpenRouteService"
              role={a.serviceRoles.ors}
              state={s(status?.openRouteService)}
              href="https://openrouteservice.org"
            />
            <Service
              name={a.serviceRoles.osrmName}
              role={a.serviceRoles.osrm}
              state={status === null ? "unknown" : status.osrmDemo ? "dev" : "off"}
              href="https://project-osrm.org"
            />
            <Service name={a.serviceRoles.estimateName} role={a.serviceRoles.estimate} state="always" />
          </ul>
        </Section>

        <Section title={a.intelligences}>
          <ul className="divide-y divide-line">
            <Service
              name={`Google Gemini${status ? ` · ${status.gemini.model}` : ""}`}
              role={a.serviceRoles.gemini}
              state={s(status?.gemini.enabled)}
              href="https://aistudio.google.com"
            />
            <Service
              name={`Groq${status ? ` · ${status.groq.model}` : ""}`}
              role={a.serviceRoles.groq}
              state={s(status?.groq.enabled)}
              href="https://console.groq.com"
            />
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted">{a.aiNote}</p>
        </Section>

        <Section title={a.privacy}>
          <p className="text-xs leading-relaxed text-muted">{a.privacyText}</p>
        </Section>

        <Section title={a.technical}>
          <dl className="overflow-hidden rounded-lg border border-line">
            {technical.map(([key, value], i) => (
              <div key={key} className={`grid grid-cols-[9rem_1fr] gap-3 px-3 py-1.5 max-[420px]:grid-cols-1 max-[420px]:gap-0 ${i > 0 ? "border-t border-line" : ""}`}>
                <dt className="text-xs text-muted">{key}</dt>
                <dd className="break-words text-xs text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            onClick={copyTechnical}
            className="focus-ring mt-2.5 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-hover"
          >
            {a.copyTechnical}
          </button>
        </Section>
      </div>

      <footer className="flex shrink-0 justify-end border-t border-line px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="focus-ring rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-on-ink hover:bg-ink/85"
        >
          {t.common.close}
        </button>
      </footer>
    </dialog>
  );
}
