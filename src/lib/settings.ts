/** Preferências de aparência, salvas em localStorage. */

export type ThemeChoice = "system" | "light" | "dark";
export type FontSize = "sm" | "md" | "lg" | "xl";
export type PanelSide = "left" | "right";
/** Onde fica o Resumo no desktop: no canto oposto ao painel ou junto dos outros blocos. */
export type SummaryDock = "corner" | "panel";

export const BLOCK_IDS = ["inicio", "paradas", "acoes", "resumo", "config"] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

export const BLOCK_NAMES: Record<BlockId, string> = {
  inicio: "Início e fim",
  paradas: "Paradas",
  acoes: "Abrir e compartilhar",
  resumo: "Resumo",
  config: "Configurações",
};

export interface Settings {
  theme: ThemeChoice;
  fontSize: FontSize;
  panelSide: PanelSide;
  summaryDock: SummaryDock;
  /** Ordem dos blocos no painel (e na gaveta do celular). */
  blockOrder: BlockId[];
}

export const SETTINGS_KEY = "rotas:config";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontSize: "md",
  panelSide: "right",
  summaryDock: "corner",
  blockOrder: [...BLOCK_IDS],
};

/** Tamanho base da fonte (px). Todo o HUD usa rem, então escala junto. */
export const FONT_PX: Record<FontSize, number> = { sm: 14, md: 16, lg: 18, xl: 20 };

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** Aceita qualquer coisa vinda do armazenamento e devolve preferências válidas. */
export function normalizeSettings(value: unknown): Settings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof Settings, unknown>>;

  // Ordem dos blocos: tira repetidos e desconhecidos, e acrescenta os que faltarem.
  const seen = new Set<BlockId>();
  const order: BlockId[] = [];
  if (Array.isArray(raw.blockOrder)) {
    for (const id of raw.blockOrder) {
      if (BLOCK_IDS.includes(id as BlockId) && !seen.has(id as BlockId)) {
        seen.add(id as BlockId);
        order.push(id as BlockId);
      }
    }
  }
  for (const id of DEFAULT_SETTINGS.blockOrder) {
    if (!seen.has(id)) order.push(id);
  }

  return {
    theme: oneOf(raw.theme, ["system", "light", "dark"] as const, DEFAULT_SETTINGS.theme),
    fontSize: oneOf(raw.fontSize, ["sm", "md", "lg", "xl"] as const, DEFAULT_SETTINGS.fontSize),
    panelSide: oneOf(raw.panelSide, ["left", "right"] as const, DEFAULT_SETTINGS.panelSide),
    summaryDock: oneOf(raw.summaryDock, ["corner", "panel"] as const, DEFAULT_SETTINGS.summaryDock),
    blockOrder: order,
  };
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): "light" | "dark" {
  return choice === "system" ? (systemPrefersDark ? "dark" : "light") : choice;
}

/** Move um item da lista de `from` para `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Roda antes da primeira pintura (script inline no <head>), para o tema e o
 * tamanho da fonte salvos valerem sem piscar.
 */
export const SETTINGS_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  SETTINGS_KEY,
)})||"{}");var d=document.documentElement;var t=s.theme==="light"||s.theme==="dark"?s.theme:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");d.dataset.theme=t;var f=${JSON.stringify(
  FONT_PX,
)}[s.fontSize];if(f)d.style.fontSize=f+"px";}catch(e){document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}})();`;
