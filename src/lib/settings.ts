/** Preferências do usuário, salvas em localStorage. */
import { MAX_DWELL_MINUTES } from "./types";

export type ThemeChoice = "system" | "light" | "dark";
export type FontSize = "sm" | "md" | "lg" | "xl";

export const BLOCK_IDS = ["inicio", "paradas", "acoes", "resumo"] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

export const BLOCK_NAMES: Record<BlockId, string> = {
  inicio: "Início e fim",
  paradas: "Paradas",
  acoes: "Abrir e compartilhar",
  resumo: "Resumo",
};

/**
 * Bloco solto sobre o mapa: distância (px) até a borda horizontal e a vertical
 * mais próximas. Guardar a borda de referência mantém o bloco no canto certo
 * quando a janela muda de tamanho.
 */
export interface FreePosition {
  h: "left" | "right";
  x: number;
  v: "top" | "bottom";
  y: number;
}

/**
 * Posição dos blocos em telas largas. Perto da borda esquerda ou direita o
 * bloco "gruda" numa coluna (empilhado com os outros); fora disso fica solto.
 */
export interface BlockLayout {
  left: BlockId[];
  right: BlockId[];
  free: Partial<Record<BlockId, FreePosition>>;
}

export interface Settings {
  /** Versão do formato salvo. Na troca de versão, valem os novos padrões. */
  version: 2;
  theme: ThemeChoice;
  fontSize: FontSize;
  /** Permanência que cada nova parada recebe (minutos). */
  defaultDwellMinutes: number;
  layout: BlockLayout;
}

export const SETTINGS_KEY = "rotas:config";

/** Margem dos blocos até a borda da tela (px). */
export const EDGE_MARGIN = 16;

export const DEFAULT_LAYOUT: BlockLayout = {
  left: [],
  right: ["inicio", "paradas", "acoes"],
  free: { resumo: { h: "left", x: EDGE_MARGIN, v: "bottom", y: EDGE_MARGIN + 16 } },
};

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  theme: "system",
  fontSize: "sm",
  defaultDwellMinutes: 0,
  layout: DEFAULT_LAYOUT,
};

/**
 * Tamanho base da fonte (px). Todo o HUD usa rem, então escala junto.
 * "sm" é o padrão: com ele os textos ficam na escala do Google Maps
 * (14 px no texto principal, 12 px no secundário).
 */
export const FONT_PX: Record<FontSize, number> = { sm: 14, md: 16, lg: 18, xl: 20 };

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const isBlock = (value: unknown): value is BlockId => BLOCK_IDS.includes(value as BlockId);

function normalizePosition(value: unknown): FreePosition | null {
  const p = value as Partial<FreePosition> | null;
  if (!p || typeof p !== "object") return null;
  if (p.h !== "left" && p.h !== "right") return null;
  if (p.v !== "top" && p.v !== "bottom") return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { h: p.h, v: p.v, x: Math.max(0, Math.round(p.x!)), y: Math.max(0, Math.round(p.y!)) };
}

/** Cada bloco aparece uma vez só: numa coluna ou solto. Os que faltarem voltam ao lugar padrão. */
export function normalizeLayout(value: unknown): BlockLayout {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof BlockLayout, unknown>>;
  const seen = new Set<BlockId>();
  const column = (list: unknown): BlockId[] => {
    const out: BlockId[] = [];
    if (!Array.isArray(list)) return out;
    for (const id of list) {
      if (isBlock(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };
  const layout: BlockLayout = { left: column(raw.left), right: column(raw.right), free: {} };

  const free = (raw.free && typeof raw.free === "object" ? raw.free : {}) as Record<string, unknown>;
  for (const id of BLOCK_IDS) {
    if (seen.has(id)) continue;
    const position = normalizePosition(free[id]);
    if (position) {
      layout.free[id] = position;
      seen.add(id);
    }
  }

  for (const id of BLOCK_IDS) {
    if (seen.has(id)) continue;
    const position = DEFAULT_LAYOUT.free[id];
    if (position) layout.free[id] = { ...position };
    else if (DEFAULT_LAYOUT.left.includes(id)) layout.left.push(id);
    else layout.right.push(id);
  }
  return layout;
}

/** Aceita qualquer coisa vinda do armazenamento e devolve preferências válidas. */
export function normalizeSettings(value: unknown): Settings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof Settings, unknown>>;
  // Formato antigo (sem versão): o tamanho da fonte volta ao padrão pequeno e os blocos ao lugar padrão.
  const current = raw.version === 2;
  const dwell = Number(raw.defaultDwellMinutes);

  return {
    version: 2,
    theme: oneOf(raw.theme, ["system", "light", "dark"] as const, DEFAULT_SETTINGS.theme),
    fontSize: current
      ? oneOf(raw.fontSize, ["sm", "md", "lg", "xl"] as const, DEFAULT_SETTINGS.fontSize)
      : DEFAULT_SETTINGS.fontSize,
    defaultDwellMinutes:
      Number.isFinite(dwell) && dwell > 0 ? Math.min(Math.round(dwell), MAX_DWELL_MINUTES) : 0,
    layout: current ? normalizeLayout(raw.layout) : normalizeLayout(DEFAULT_LAYOUT),
  };
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): "light" | "dark" {
  return choice === "system" ? (systemPrefersDark ? "dark" : "light") : choice;
}

/**
 * Roda antes da primeira pintura (script inline no <head>), para o tema e o
 * tamanho da fonte salvos valerem sem piscar.
 */
export const SETTINGS_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  SETTINGS_KEY,
)})||"{}");var d=document.documentElement;var t=s.theme==="light"||s.theme==="dark"?s.theme:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");d.dataset.theme=t;var p=${JSON.stringify(
  FONT_PX,
)};var f=(s.version===2&&p[s.fontSize])||p.sm;d.style.fontSize=f+"px";}catch(e){document.documentElement.style.fontSize=${FONT_PX.sm}+"px";document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}})();`;
