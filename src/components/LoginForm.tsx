"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { inputClass } from "./PlaceField";

export default function LoginForm() {
  const router = useRouter();
  const inputId = useId();
  const errorId = `${inputId}-erro`;
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Com o cookie gravado, o proxy libera a página inicial.
        router.replace("/");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Não foi possível entrar.");
    } catch {
      setError("Sem conexão com o servidor.");
    }
    setBusy(false);
  };

  return (
    <form
      onSubmit={submit}
      className="flex w-full max-w-xs flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div>
        <h1 className="text-lg font-semibold">Planejador de rotas</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Site pessoal. Informe a senha para entrar.</p>
      </div>
      <div>
        <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Senha
        </label>
        <input
          id={inputId}
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className={inputClass}
          value={password}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={busy || !password}
        className="focus-ring rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
