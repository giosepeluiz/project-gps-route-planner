"use client";

import Grip, { gripButtonClass } from "./Grip";
import { dragRowClass, useDragReorder } from "./useDragReorder";
import {
  BLOCK_NAMES,
  DEFAULT_SETTINGS,
  moveItem,
  type FontSize,
  type PanelSide,
  type Settings,
  type SummaryDock,
  type ThemeChoice,
} from "@/lib/settings";

interface SettingsPanelProps {
  settings: Settings;
  onChange: (next: Settings) => void;
}

interface Option<T extends string> {
  value: T;
  label: string;
}

/** Grupo de opções exclusivas, no estilo "controle segmentado". */
function Segmented<T extends string>({
  legend,
  options,
  value,
  onSelect,
}: {
  legend: string;
  options: Option<T>[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{legend}</legend>
      <div
        className="grid gap-1 rounded-lg bg-zinc-200 p-1 dark:bg-zinc-800"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onSelect(option.value)}
            className={`focus-ring rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors duration-200 motion-reduce:transition-none ${
              value === option.value
                ? "bg-white text-zinc-900 shadow dark:bg-zinc-600 dark:text-white"
                : "text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const THEMES: Option<ThemeChoice>[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];
const FONTS: Option<FontSize>[] = [
  { value: "sm", label: "Pequena" },
  { value: "md", label: "Normal" },
  { value: "lg", label: "Grande" },
  { value: "xl", label: "Enorme" },
];
const SIDES: Option<PanelSide>[] = [
  { value: "left", label: "Esquerda" },
  { value: "right", label: "Direita" },
];
const DOCKS: Option<SummaryDock>[] = [
  { value: "corner", label: "No canto oposto" },
  { value: "panel", label: "Junto dos blocos" },
];

export default function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  const order = settings.blockOrder;
  const reorder = useDragReorder(order.length, (from, to) =>
    set("blockOrder", moveItem(order, from, to)),
  );

  return (
    <div className="flex flex-col gap-3">
      <Segmented legend="Tema" options={THEMES} value={settings.theme} onSelect={(v) => set("theme", v)} />
      <Segmented
        legend="Tamanho da fonte"
        options={FONTS}
        value={settings.fontSize}
        onSelect={(v) => set("fontSize", v)}
      />
      <Segmented
        legend="Lado do painel (telas largas)"
        options={SIDES}
        value={settings.panelSide}
        onSelect={(v) => set("panelSide", v)}
      />
      <Segmented
        legend="Posição do Resumo (telas largas)"
        options={DOCKS}
        value={settings.summaryDock}
        onSelect={(v) => set("summaryDock", v)}
      />

      <div>
        <p className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Ordem dos blocos (arraste pela alça)
        </p>
        <ol className="flex flex-col" style={{ gap: reorder.gapPx }}>
          {order.map((id, i) => {
            const dragging = reorder.draggingIndex === i;
            return (
              <li
                key={id}
                ref={reorder.rowRef(i)}
                style={{ transform: `translateY(${reorder.offsetOf(i)}px)` }}
                className={`relative flex items-center gap-2 rounded-lg py-0.5 pl-0.5 pr-2 ${dragRowClass(
                  dragging,
                  reorder.draggingIndex !== null,
                )}`}
              >
                <button
                  type="button"
                  aria-label={`Arrastar o bloco ${BLOCK_NAMES[id]} para reordenar. Com o teclado, use as setas para cima e para baixo.`}
                  title="Arraste para reordenar"
                  className={`${gripButtonClass} ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                  {...reorder.handleProps(i)}
                >
                  <Grip />
                </button>
                <span className="w-4 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{i + 1}</span>
                <span className="text-sm">{BLOCK_NAMES[id]}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <button
        type="button"
        onClick={() => onChange(DEFAULT_SETTINGS)}
        className="focus-ring self-start rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
      >
        Restaurar o padrão
      </button>
    </div>
  );
}
