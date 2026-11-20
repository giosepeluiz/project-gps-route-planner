import { describe, expect, it } from "vitest";
import { buildPdf, pageBreaks } from "./pdf-file";

describe("arquivo PDF", () => {
  it("monta um PDF válido com uma página por imagem", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const bytes = buildPdf([{ jpeg, width: 10, height: 10 }, { jpeg, width: 10, height: 10 }], "Relatório");
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // O endereço do xref confere com a posição real.
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });
  it("corta as páginas embaixo de blocos inteiros", () => {
    expect(pageBreaks(500, [100, 300], 1000)).toEqual([[0, 500]]);
    expect(pageBreaks(2000, [300, 800, 950, 1100, 1900], 1000)).toEqual([[0, 950], [950, 1900], [1900, 2000]]);
    // Sem bloco que caiba: corta no limite.
    expect(pageBreaks(1500, [], 1000)).toEqual([[0, 1000], [1000, 1500]]);
  });
});
