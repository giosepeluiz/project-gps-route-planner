"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const STORAGE_EVENT = "rotas:storage";
/** Cópia em memória, para a interface funcionar mesmo sem acesso ao localStorage. */
const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener(STORAGE_EVENT, onChange);
  return () => window.removeEventListener(STORAGE_EVENT, onChange);
}

/**
 * Estado salvo em localStorage. No servidor (e na hidratação) vale `fallback`,
 * que precisa ser uma referência estável (constante de módulo).
 */
export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  /** Valida o que veio do armazenamento; se devolver false, vale o fallback. */
  isValid: (value: unknown) => boolean = () => true,
): [T, (next: T | ((previous: T) => T)) => void] {
  const raw = useSyncExternalStore(
    subscribeStorage,
    () => readRaw(key),
    () => null,
  );

  const parse = useCallback(
    (text: string | null): T => {
      if (text === null) return fallback;
      try {
        const parsed: unknown = JSON.parse(text);
        return isValid(parsed) ? (parsed as T) : fallback;
      } catch {
        return fallback;
      }
    },
    [fallback, isValid],
  );

  const value = useMemo<T>(() => parse(raw), [raw, parse]);

  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      // A forma com função lê o valor mais recente (útil em respostas assíncronas).
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(parse(readRaw(key))) : next;
      const json = JSON.stringify(resolved);
      memory.set(key, json);
      try {
        window.localStorage.setItem(key, json);
      } catch {
        // Sem localStorage (modo privado, cota cheia): fica só em memória.
      }
      window.dispatchEvent(new Event(STORAGE_EVENT));
    },
    [key, parse],
  );

  return [value, setValue];
}

/** true quando a media query casa. No servidor vale false (layout de celular). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function subscribeClock(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 5000);
  return () => window.clearInterval(timer);
}

/**
 * Minuto atual (epoch em minutos), atualizado sozinho.
 * Devolve null no servidor, para a hora nunca entrar no HTML pré-renderizado.
 */
export function useCurrentMinute(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
}
