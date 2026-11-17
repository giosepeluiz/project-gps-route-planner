import { connection, NextResponse } from "next/server";
import { serviceStatus } from "@/lib/server/services";

/**
 * GET /api/status
 * Quais serviços estão ligados neste servidor (para a tela Sobre). Só
 * booleanos e nomes de modelo: as chaves nunca saem do servidor.
 */
export async function GET() {
  // Com Cache Components, um GET sem dados da requisição seria pré-renderizado no
  // build; connection() faz ele rodar a cada pedido, lendo as variáveis de agora.
  await connection();
  return NextResponse.json(serviceStatus(), { headers: { "Cache-Control": "no-store" } });
}
