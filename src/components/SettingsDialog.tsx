"use client";

import { useEffect, useRef, type ReactNode } from "react";
import DwellPicker from "./DwellPicker";
import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  type FontSize,
  type Settings,
  type ThemeChoice,
} from "@/lib/settings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (next: Settings) => void;
}

interface Option<T extends string> {
  value: T;
  label: string;
}

/** Grupo de opções exclusivas, no estilo "controle segmentado". */
function Segmented<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-0.5 rounded-lg bg-sunken p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onSelect(option.value)}
          className={`focus-ring rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors duration-150 motion-reduce:transition-none ${
            value === option.value
              ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              : "text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Uma linha de configuração: nome e explicação curta, com o controle embaixo. */
function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3">
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-5 pt-4">
      <h3 className="text-2xs font-semibold uppercase tracking-[0.06em] text-muted">{title}</h3>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

const THEMES: Option<ThemeChoice>[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];
const FONTS: Option<FontSize>[] = [
  { value: "sm", label: "Pequeno" },
  { value: "md", label: "Médio" },
  { value: "lg", label: "Grande" },
  { value: "xl", label: "Enorme" },
];

/** Tela de configurações: diálogo no centro (desktop) ou em tela cheia (celular). */
export default function SettingsDialog({ open, onClose, settings, onChange }: SettingsDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });

  return (
    <dialog
      ref={ref}
      aria-labelledby="config-titulo"
      onClose={onClose}
      // Clique fora do conteúdo (no fundo escurecido) fecha.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[min(44rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/40 open:flex open:flex-col max-md:h-dvh max-md:max-h-none max-md:w-full max-md:max-w-none max-md:rounded-none max-md:border-0"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 id="config-titulo" className="text-base font-semibold">
          Configurações
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar configurações"
          className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <Section title="Aparência">
          <Row title="Tema">
            <Segmented label="Tema" options={THEMES} value={settings.theme} onSelect={(v) => set("theme", v)} />
          </Row>
          <Row title="Tamanho do texto" hint="Pequeno é o padrão, na mesma escala do Google Maps.">
            <Segmented
              label="Tamanho do texto"
              options={FONTS}
              value={settings.fontSize}
              onSelect={(v) => set("fontSize", v)}
            />
          </Row>
        </Section>

        <Section title="Rota">
          <Row
            title="Permanência padrão"
            hint="Tempo que cada nova parada recebe. Dá para mudar em cada parada pelo ícone de relógio."
          >
            <DwellPicker
              label="Permanência padrão nas novas paradas"
              value={settings.defaultDwellMinutes}
              onChange={(minutes) => set("defaultDwellMinutes", minutes)}
            />
          </Row>
        </Section>

        <Section title="Blocos">
          <Row
            title="Posição dos blocos"
            hint="Arraste um bloco pelo título para onde quiser. Perto da borda esquerda ou direita ele gruda numa coluna; perto do topo ou da base, gruda na margem. No celular os blocos ficam na gaveta, na mesma ordem."
          >
            <button
              type="button"
              onClick={() => set("layout", DEFAULT_LAYOUT)}
              className="focus-ring self-start rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium hover:bg-hover"
            >
              Voltar os blocos ao lugar padrão
            </button>
          </Row>
        </Section>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-5 py-3">
        <button
          type="button"
          onClick={() => onChange(DEFAULT_SETTINGS)}
          className="focus-ring rounded-lg px-2 py-1.5 text-xs font-medium text-muted hover:bg-hover hover:text-ink"
        >
          Restaurar tudo
        </button>
        <button
          type="button"
          onClick={onClose}
          className="focus-ring rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-on-ink hover:bg-ink/85"
        >
          Pronto
        </button>
      </footer>
    </dialog>
  );
}
