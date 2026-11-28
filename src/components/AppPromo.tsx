"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "./I18nProvider";
import { PLATFORM_NAMES, PlatformIcon } from "./PlatformIcons";
import {
  APP_RELEASES_URL,
  currentPlatform,
  formatSize,
  isInsideApp,
  type AppRelease,
  type DownloadFile,
  type Platform,
} from "@/lib/app-download";
import { useLocalStorageState } from "@/lib/hooks";

const KEY = "rotas:app-promo:v1";

interface PromoState {
  /** Painel recolhido (só o botão pequeno). */
  collapsed: boolean;
  /** A pessoa pediu para não mostrar mais. */
  hidden: boolean;
  /** Posição do painel no PC (px, canto superior esquerdo), ou null para a posição padrão. */
  pos: { x: number; y: number } | null;
}

const DEFAULT_STATE: PromoState = { collapsed: false, hidden: false, pos: null };
/** Ao lado da coluna esquerda de blocos (23 rem + margens), no alto do mapa. */
const DEFAULT_POS = { x: 408, y: 16 };

const noopSubscribe = () => () => {};

/** Sistema do aparelho (null no servidor e dentro do próprio app). */
function usePlatform(): Platform | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => (isInsideApp() ? null : currentPlatform()),
    () => null,
  );
}

function useRelease(enabled: boolean): AppRelease | null | undefined {
  // undefined = carregando; null = sem release.
  const [release, setRelease] = useState<AppRelease | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/app-release")
      .then((r) => (r.ok ? r.json() : { release: null }))
      .then((data: { release: AppRelease | null }) => alive && setRelease(data.release))
      .catch(() => alive && setRelease(null));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return release;
}

/** O arquivo do sistema nesta release. */
const fileFor = (release: AppRelease | null | undefined, platform: Platform): DownloadFile | undefined =>
  platform === "windows"
    ? release?.windows
    : platform === "mac"
      ? release?.mac
      : platform === "linux"
        ? release?.linux
        : platform === "android"
          ? release?.android
          : undefined;

const buttonClass =
  "focus-ring flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 dark:text-[#10131c]";

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

/** Botão de baixar o arquivo de um sistema (ou o aviso, quando não há). */
function DownloadButton({ platform, file, release }: { platform: Platform; file?: DownloadFile; release: AppRelease | null | undefined }) {
  const t = useT();
  const name = PLATFORM_NAMES[platform];
  if (file) {
    return (
      <a href={file.url} className={buttonClass}>
        <PlatformIcon platform={platform} className="h-4 w-4" />
        <span>{t.appPromo.download(name)}</span>
        <span className="text-xs font-normal opacity-80">{formatSize(file.size)}</span>
      </a>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-lg bg-sunken px-3 py-2 text-xs leading-relaxed text-ink-2">
        {release === undefined ? t.appPromo.loading : t.appPromo.soon(name)}
      </p>
      <a
        href={release?.url ?? APP_RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring text-center text-xs font-medium text-accent hover:underline"
      >
        {t.appPromo.allDownloads}
      </a>
    </div>
  );
}

/**
 * PC: painel no canto superior esquerdo, arrastável pelo cabeçalho e que recolhe
 * num botão pequeno. Mostra o download do sistema da pessoa e o do Android.
 */
export function AppPromoDesktop({ suspended }: { suspended: boolean }) {
  const t = useT();
  const platform = usePlatform();
  const [state, setState] = useLocalStorageState<PromoState>(KEY, DEFAULT_STATE);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const supported = platform === "windows" || platform === "mac" || platform === "linux" || platform === "other";
  const active = supported && !state.hidden && !suspended;
  const release = useRelease(active);
  if (!active || !platform) return null;

  const pos = dragPos ?? state.pos ?? DEFAULT_POS;
  const mainPlatform: Platform = platform === "other" ? "windows" : platform;

  const startDrag = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("button, a")) return;
    const box = boxRef.current;
    if (!box) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...pos };
    let moved = false;
    let last = origin;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      last = {
        x: Math.max(0, Math.min(origin.x + dx, window.innerWidth - box.offsetWidth)),
        y: Math.max(0, Math.min(origin.y + dy, window.innerHeight - 48)),
      };
      setDragPos(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) setState((s) => ({ ...s, pos: last }));
      else if (state.collapsed) setState((s) => ({ ...s, collapsed: false }));
      setDragPos(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const style = { left: pos.x, top: pos.y };

  if (state.collapsed) {
    return (
      <div ref={boxRef} style={style} className="fixed z-20">
        <div
          onPointerDown={startDrag}
          title={t.appPromo.expand}
          className="flex cursor-grab touch-none select-none items-center gap-2 rounded-full border border-line bg-surface/95 py-1.5 pl-3 pr-3.5 text-sm font-semibold text-ink shadow-panel backdrop-blur-sm hover:border-line-strong active:cursor-grabbing"
        >
          <PlatformIcon platform={mainPlatform} className="h-4 w-4" />
          <span>{t.appPromo.short}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      style={style}
      role="region"
      aria-label={t.appPromo.aria}
      className="fixed z-20 w-72 overflow-hidden rounded-2xl border border-line bg-surface/95 shadow-panel backdrop-blur-sm"
    >
      <div onPointerDown={startDrag} title={t.appPromo.drag} className="flex cursor-grab touch-none select-none items-center gap-2.5 px-3 pb-1 pt-3 active:cursor-grabbing">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sunken text-ink">
          <PlatformIcon platform={mainPlatform} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-compact font-semibold text-ink">{t.appPromo.title}</span>
          {release && <span className="block truncate text-xs text-muted">{t.appPromo.version(release.version)}</span>}
        </span>
        <button
          type="button"
          onClick={() => setState((s) => ({ ...s, collapsed: true }))}
          aria-label={t.appPromo.collapse}
          title={t.appPromo.collapse}
          className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 8l5 5 5-5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setState((s) => ({ ...s, hidden: true }))}
          aria-label={t.appPromo.dismiss}
          title={t.appPromo.dismiss}
          className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
        <p className="text-xs leading-relaxed text-ink-2">{t.appPromo.lead}</p>
        <DownloadButton platform={mainPlatform} file={fileFor(release, mainPlatform)} release={release} />
        {mainPlatform === "windows" && release?.windowsPortable && (
          <a href={release.windowsPortable.url} className="focus-ring -mt-1 text-center text-xs font-medium text-accent hover:underline">
            {t.appPromo.portable} · {formatSize(release.windowsPortable.size)}
          </a>
        )}
        <div className="flex items-center gap-2.5 border-t border-line pt-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink">
            <PlatformIcon platform="android" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">{t.appPromo.alsoAndroid}</span>
          {release?.android ? (
            <a
              href={release.android.url}
              className="focus-ring shrink-0 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-hover"
            >
              APK · {formatSize(release.android.size)}
            </a>
          ) : (
            <a
              href={release?.url ?? APP_RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring shrink-0 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-hover"
            >
              {t.appPromo.allDownloads}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Celular Android: uma linha no alto da bandeja (sem cobrir o mapa nem os botões
 * do topo). Tocar abre uma janela com o botão de baixar o APK.
 */
export function AppPromoMobile({ suspended }: { suspended: boolean }) {
  const t = useT();
  const platform = usePlatform();
  const [state, setState] = useLocalStorageState<PromoState>(KEY, DEFAULT_STATE);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active = platform === "android" && !state.hidden && !suspended;
  const release = useRelease(active);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!active) return null;

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line bg-sunken/60 px-4 py-2.5">
        <button type="button" onClick={() => setOpen(true)} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-white dark:text-[#10131c]">
            <PlatformIcon platform="android" className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{t.appPromo.mobileTitle}</span>
            <span className="block truncate text-xs text-muted">{t.appPromo.mobileHint}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setState((s) => ({ ...s, hidden: true }))}
          aria-label={t.appPromo.dismiss}
          className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <CloseIcon />
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="app-promo-titulo"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => e.target === dialogRef.current && setOpen(false)}
        className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-4 px-6 pb-5 pt-6">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent text-white dark:text-[#10131c]">
            <PlatformIcon platform="android" className="h-8 w-8" />
          </span>
          <div>
            <h2 id="app-promo-titulo" className="text-lg font-semibold">
              {t.appPromo.modalTitle}
            </h2>
            {release && <p className="mt-0.5 text-xs text-muted">{t.appPromo.version(release.version)}</p>}
          </div>
          <p className="text-sm leading-relaxed text-ink-2">{t.appPromo.lead}</p>
          <p className="rounded-lg bg-sunken px-3 py-2 text-xs leading-relaxed text-ink-2">{t.appPromo.androidNote}</p>
          <DownloadButton platform="android" file={release?.android} release={release} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="focus-ring rounded-lg border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:bg-hover"
          >
            {t.appPromo.later}
          </button>
        </div>
      </dialog>
    </>
  );
}
