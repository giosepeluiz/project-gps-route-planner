/**
 * Gera o arquivo PDF dos relatórios direto no navegador, sem biblioteca e sem
 * janela de impressão: o documento HTML do relatório é desenhado num canvas,
 * dividido em páginas A4 (sem cortar linhas no meio) e cada página entra no PDF
 * como imagem JPEG. O texto fica como imagem (não dá para selecionar).
 */

export interface PdfPage {
  /** Bytes de um JPEG. */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const A4_W_PT = 595.28;
const A4_H_PT = 841.89;

const ascii = (s: string) => new TextEncoder().encode(s);
/** Texto como string hexadecimal UTF-16BE (aceita acentos no título do PDF). */
const hexUtf16 = (s: string) =>
  "<FEFF" + [...s].map((c) => c.codePointAt(0)!.toString(16).padStart(4, "0").slice(-4)).join("").toUpperCase() + ">";

/** Monta o PDF (uma imagem por página A4). */
export function buildPdf(pages: readonly PdfPage[], title: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? ascii(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push("\nendobj\n");
  };

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const pageObj = (i: number) => 4 + i * 3;
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () =>
    push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>`),
  );
  object(3, () => push(`<< /Title ${hexUtf16(title)} /Producer (Planejador de Rotas) >>`));
  pages.forEach((page, i) => {
    const id = pageObj(i);
    const content = `q ${A4_W_PT} 0 0 ${A4_H_PT} 0 0 cm /Im0 Do Q`;
    object(id, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W_PT} ${A4_H_PT}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
      ),
    );
    object(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(id + 2, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      );
      push(page.jpeg);
      push("\nendstream");
    });
  });

  const total = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// ---------- HTML → páginas ----------

const PAGE_W = 794; // A4 a 96 dpi
const PAGE_H = 1123;
const MARGIN_X = 40;
const MARGIN_Y = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_H = PAGE_H - MARGIN_Y * 2;
const SCALE = 2;

const toDataUrl = async (src: string): Promise<string> => {
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

/** Onde cortar cada página: sempre embaixo de um bloco inteiro (tabela, parágrafo, gráfico). */
export function pageBreaks(height: number, bottoms: readonly number[], pageHeight = CONTENT_H): [number, number][] {
  const pages: [number, number][] = [];
  let start = 0;
  while (start < height - 1) {
    const limit = start + pageHeight;
    // Um pouco além do limite ainda cabe (invade só a margem de baixo).
    if (height <= limit + 40) {
      pages.push([start, height]);
      break;
    }
    const fits = bottoms.filter((b) => b <= limit && b > start + pageHeight * 0.25);
    const end = fits.length > 0 ? Math.max(...fits) : limit;
    pages.push([start, end]);
    start = end;
  }
  return pages;
}

/** Desenha o documento HTML do relatório e devolve o PDF. Pode falhar (ex.: navegador que não deixa copiar o desenho). */
export async function htmlToPdf(html: string, title: string): Promise<Blob> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${CONTENT_W}px;height:1200px;border:0;visibility:hidden`;
  frame.srcdoc = html;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      window.setTimeout(() => reject(new Error("timeout")), 15_000);
    });
    const doc = frame.contentDocument!;
    // Só o conteúdo: sem o aviso de impressão e sem margens da página.
    doc.querySelector(".hint")?.remove();
    const override = doc.createElement("style");
    override.textContent = `.page{max-width:none!important;padding:0!important;margin:0!important}`;
    doc.head.appendChild(override);
    // Imagens como data URL (o desenho em SVG não carrega arquivos externos).
    for (const img of [...doc.images]) {
      if (!img.src.startsWith("data:")) img.src = await toDataUrl(img.src).catch(() => "");
    }
    await Promise.all(
      [...doc.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))),
    );

    const body = doc.body;
    const top = body.getBoundingClientRect().top;
    const height = Math.ceil(body.scrollHeight);
    const bottoms = [...body.querySelectorAll("header,.meta,p,tr,.kpis,.map,.charts,.finding,.box,table,footer")]
      // Linha de cabeçalho de tabela não termina página (ficaria sozinha).
      .filter((el) => !(el.tagName === "TR" && el.querySelector("th")))
      .map((el) => el.getBoundingClientRect().bottom - top);

    const root = doc.createElement("div");
    root.className = "pdfroot";
    for (const style of doc.querySelectorAll("style")) {
      const clone = style.cloneNode(true) as HTMLStyleElement;
      clone.textContent = (clone.textContent ?? "").replace(/(^|\})\s*body\s*\{/, "$1.pdfroot{");
      root.appendChild(clone);
    }
    for (const child of [...body.childNodes]) root.appendChild(child.cloneNode(true));
    const xhtml = new XMLSerializer().serializeToString(root);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTENT_W}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("render"));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });

    // Passou pouco de uma folha A4: encolhe o conteúdo para caber numa só, em vez de deixar uma segunda folha quase vazia.
    const shrink = height > CONTENT_H && height <= CONTENT_H * 1.3 ? CONTENT_H / height : 1;
    const ranges: [number, number][] = shrink < 1 ? [[0, height]] : pageBreaks(height, bottoms);
    const pages: PdfPage[] = [];
    for (const [start, end] of ranges) {
      const canvas = document.createElement("canvas");
      canvas.width = PAGE_W * SCALE;
      canvas.height = PAGE_H * SCALE;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        image,
        0,
        start * SCALE,
        CONTENT_W * SCALE,
        (end - start) * SCALE,
        (MARGIN_X + (CONTENT_W * (1 - shrink)) / 2) * SCALE,
        MARGIN_Y * SCALE,
        CONTENT_W * SCALE * shrink,
        (end - start) * SCALE * shrink,
      );
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("canvas");
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
    }
    return new Blob([buildPdf(pages, title) as BlobPart], { type: "application/pdf" });
  } finally {
    frame.remove();
  }
}

/** Baixa o arquivo direto (sem abrir janela nem a impressão). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
