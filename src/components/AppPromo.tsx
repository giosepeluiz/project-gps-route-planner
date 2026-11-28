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

export interface AppPromoInfo {
  /** Sistema do aparelho, ou null quando não há o que promover. */
  platform: Platform | null;
  /** Aparelho de mesa onde o bloco aparece (Windows, macOS, Linux). */
  desktop: boolean;
  /** Celular Android, onde aparece a linha da bandeja. */
  android: boolean;
  /** Sistema mostrado no PC (sistema desconhecido cai no Windows). */
  main: Platform;
  release: AppRelease | null | undefined;
}

/**
 * O que a divulgação do app precisa saber: o sistema, e a release do GitHub
 * (buscada só quando o bloco vai aparecer). `hidden` esconde, ex.: durante a viagem.
 */
export function useAppPromo(hidden: boolean): AppPromoInfo {
  const platform = usePlatform();
  const desktop = !hidden && (platform === "windows" || platform === "mac" || platform === "linux" || platform === "other");
  const android = !hidden && platform === "android";
  const release = useRelease(desktop || android);
  return { platform, desktop, android, main: platform === "other" || platform === null ? "windows" : platform, release };
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

/** Resumo do bloco recolhido: sistema e versão. */
export function appPromoSummary(promo: AppPromoInfo): string {
  const version = promo.release ? ` · v${promo.release.version}` : "";
  return `${PLATFORM_NAMES[promo.main]}${version}`;
}

/** Conteúdo do bloco do PC (dentro de um cartão como os outros). */
export function AppPromoContent({ promo }: { promo: AppPromoInfo }) {
  const t = useT();
  const { main, release } = promo;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sunken text-ink">
          <PlatformIcon platform={main} className="h-5 w-5" />
        </span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-2">
          {t.appPromo.lead}
          {release && <span className="block text-muted">{t.appPromo.version(release.version)}</span>}
        </p>
      </div>
      <DownloadButton platform={main} file={fileFor(release, main)} release={release} />
      {main === "windows" && release?.windowsPortable && (
        <a href={release.windowsPortable.url} className="focus-ring -mt-1 text-center text-xs font-medium text-accent hover:underline">
          {t.appPromo.portable} · {formatSize(release.windowsPortable.size)}
        </a>
      )}
      <div className="flex items-center gap-2.5 border-t border-line pt-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink">
          <PlatformIcon platform="android" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">{t.appPromo.alsoAndroid}</span>
        <a
          href={release?.android?.url ?? release?.url ?? APP_RELEASES_URL}
          {...(release?.android ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          className="focus-ring shrink-0 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-hover"
        >
          {release?.android ? `APK · ${formatSize(release.android.size)}` : t.appPromo.allDownloads}
        </a>
      </div>
    </div>
  );
}

/**
 * Celular Android: uma linha na bandeja (sem cobrir o mapa nem os botões do
 * topo). Tocar abre uma janela com o botão de baixar o APK.
 */
export function AppPromoMobile({ promo }: { promo: AppPromoInfo }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { release } = promo;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!promo.android) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring flex w-full items-center gap-3 border-b border-line bg-sunken/60 px-4 py-2.5 text-left"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-white dark:text-[#10131c]">
          <PlatformIcon platform="android" className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{t.appPromo.mobileTitle}</span>
          <span className="block truncate text-xs text-muted">{t.appPromo.mobileHint}</span>
        </span>
      </button>

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
