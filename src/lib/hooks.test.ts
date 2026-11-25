import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetStoredCopy } from "./hooks";

describe("viagem encerrada some do armazenamento", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remove a chave do localStorage", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { removeItem } });
    forgetStoredCopy("rotas:rota:v2");
    expect(removeItem).toHaveBeenCalledWith("rotas:rota:v2");
  });

  it("não quebra sem acesso ao localStorage", () => {
    vi.stubGlobal("window", {
      localStorage: {
        removeItem: () => {
          throw new Error("bloqueado");
        },
      },
    });
    expect(() => forgetStoredCopy("rotas:rota:v2")).not.toThrow();
  });
});
