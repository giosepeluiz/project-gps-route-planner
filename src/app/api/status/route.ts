import { NextResponse } from "next/server";
import { serviceStatus } from "@/lib/server/services";

/**
 * GET /api/status
 * Quais serviços estão ligados neste servidor (para a tela Sobre). Só
 * booleanos e nomes de modelo: as chaves nunca saem do servidor.
 */
export async function GET() {
  return NextResponse.json(serviceStatus(), { headers: { "Cache-Control": "no-store" } });
}
