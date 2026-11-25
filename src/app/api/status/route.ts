import { connection, NextResponse } from "next/server";
import { getServices, serviceStatus } from "@/lib/server/services";

/**
 * GET /api/status
 * Quais serviços estão ligados neste servidor (para a tela Sobre). Só
 * booleanos e nomes de modelo: as chaves nunca saem do servidor.
 */
export async function GET() {
  // Com Cache Components, um GET sem dados da requisição seria pré-renderizado no
  // build; connection() faz ele rodar a cada pedido, lendo as variáveis de agora.
  await connection();
  const usage = await getServices().budget.usage();
  return NextResponse.json({ ...serviceStatus(), usage }, { headers: { "Cache-Control": "no-store" } });
}
