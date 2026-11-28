import { connection, NextResponse } from "next/server";
import { APP_REPO, releaseFromGitHub, type AppRelease } from "@/lib/app-download";

/** A release muda raramente: guarda a resposta por 30 minutos para não gastar o limite da API do GitHub. */
const TTL_MS = 30 * 60 * 1000;
let cached: { at: number; release: AppRelease | null } | null = null;

/**
 * GET /api/app-release
 * Última versão do app (Windows, Linux, macOS, Android) nas Releases do GitHub,
 * para a promoção de download. Sem a release, responde release: null.
 */
export async function GET() {
  await connection();
  if (!cached || Date.now() - cached.at > TTL_MS) {
    let release: AppRelease | null = null;
    try {
      const response = await fetch(`https://api.github.com/repos/${APP_REPO}/releases?per_page=5`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "rotas-web" },
        signal: AbortSignal.timeout(6000),
      });
      if (response.ok) {
        // As versões beta são pré-lançamentos, que /releases/latest ignora: pega a mais recente da lista.
        const list = (await response.json()) as { draft?: boolean }[];
        const newest = list.find((r) => !r.draft);
        if (newest) release = releaseFromGitHub(newest as Parameters<typeof releaseFromGitHub>[0]);
      }
    } catch {
      // Sem resposta do GitHub: a tela mostra só o link das Releases.
    }
    // Falha não fica guardada por muito tempo: tenta de novo em 2 minutos.
    cached = { at: release ? Date.now() : Date.now() - TTL_MS + 2 * 60 * 1000, release };
  }
  return NextResponse.json({ release: cached.release }, { headers: { "Cache-Control": "public, max-age=300" } });
}
