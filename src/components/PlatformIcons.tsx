import type { Platform } from "@/lib/app-download";

interface IconProps {
  className?: string;
}

/** Ícones dos sistemas (traço simples, na cor do texto). */
export function WindowsIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M3 5.5l7.6-1.1v6.8H3zM11.6 4.25L21 3v8.2h-9.4zM3 12.2h7.6V19L3 17.9zM11.6 12.2H21V21l-9.4-1.3z" />
    </svg>
  );
}

export function AppleIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.8-3-.8C6.9 7.5 5.4 8.4 4.6 9.8c-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.8 2.4 3 2.4 1.2 0 1.7-.8 3.1-.8s1.8.8 3.1.8 2.1-1.1 2.9-2.3c.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.5-3.9zM14.2 5.7c.6-.8 1.1-1.9.9-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.2-.5 2.8-1.3z" />
    </svg>
  );
}

export function LinuxIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2.5c-2 0-3.2 1.7-3.2 4 0 1.2-.4 2.1-1.2 3.3C6.4 11.5 5 13.6 5 16c0 1.3.5 2.3 1.4 2.9-.3.8-.9 1.2-1.9 1.5-.8.3-.6 1.1.4 1.1 1.7 0 3-.3 3.6-1.1.8.2 1.6.3 2.5.3s1.7-.1 2.5-.3c.6.8 1.9 1.1 3.6 1.1 1 0 1.2-.8.4-1.1-1-.3-1.6-.7-1.9-1.5.9-.6 1.4-1.6 1.4-2.9 0-2.4-1.4-4.5-2.6-6.2-.8-1.2-1.2-2.1-1.2-3.3 0-2.3-1.2-4-3.2-4zm-1.3 4a.8.8 0 110 1.7.8.8 0 010-1.7zm2.6 0a.8.8 0 110 1.7.8.8 0 010-1.7zM12 8.6c.9 0 1.6.4 1.6.9 0 .4-.7 1-1.6 1s-1.6-.6-1.6-1c0-.5.7-.9 1.6-.9z" />
    </svg>
  );
}

export function AndroidIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M6.2 9.5h11.6v8.2a1.3 1.3 0 01-1.3 1.3H15v2.3a1.2 1.2 0 01-2.4 0V19h-1.2v2.3a1.2 1.2 0 01-2.4 0V19H7.5a1.3 1.3 0 01-1.3-1.3zM3.6 9.7a1.2 1.2 0 012.4 0v5.6a1.2 1.2 0 01-2.4 0zm14.4 0a1.2 1.2 0 012.4 0v5.6a1.2 1.2 0 01-2.4 0zM6.4 8.5a5.6 5.6 0 0111.2 0zM8.3 3.6l-1-1.7a.3.3 0 01.5-.3l1.1 1.7a6.4 6.4 0 016.2 0l1.1-1.7a.3.3 0 01.5.3l-1 1.7a5.5 5.5 0 012.3 3.7H6a5.5 5.5 0 012.3-3.7zM9.5 6.2a.7.7 0 100-1.4.7.7 0 000 1.4zm5 0a.7.7 0 100-1.4.7.7 0 000 1.4z" fillRule="evenodd" />
    </svg>
  );
}

/** Ícone do sistema. */
export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  if (platform === "windows") return <WindowsIcon className={className} />;
  if (platform === "mac" || platform === "ios") return <AppleIcon className={className} />;
  if (platform === "android") return <AndroidIcon className={className} />;
  return <LinuxIcon className={className} />;
}

/** Nome do sistema (nomes próprios, iguais em todos os idiomas). */
export const PLATFORM_NAMES: Record<Platform, string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
  other: "",
};
