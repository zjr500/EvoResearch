import { PDFParse } from "pdf-parse";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function readPdf(filePath: string, suppliedBuffer?: Buffer) {
  // 读取 PDF 文件内容
  const buffer = suppliedBuffer ?? await readFile(filePath);

  // 检查文件是否为 PDF
  if (buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("文件不是有效的 PDF 格式");
  }

  // 计算文件的 SHA-256 哈希
  const contentHash = createHash("sha256")
    .update(buffer)
    .digest("hex");

// 提取 PDF 正文
const parser = new PDFParse({ data: buffer });

let text: string;
let metadata: Record<string, unknown> = {};

try {
  const result = await parser.getText();
  text = result.text;
  try { metadata = (await parser.getInfo()).info as Record<string, unknown>; } catch { /* Metadata may be absent in valid PDFs. */ }
} finally {
  await parser.destroy();
}

return {
    buffer,
    contentHash,
    text,
    metadata,
  };
}



export function extractAbstract(text: string): string | null {
    const start = text.match(
      /(?:^|\n)\s*(?:Abstract|摘要)\s*[:：]?\s*\n?/i
    );

    if (!start || start.index === undefined) {
      return null;
    }

    const remaining = text.slice(start.index + start[0].length);

    const end = remaining.search(
      /(?:^|\n)\s*(?:(?:Key\s*words?|Index Terms|关键词)\s*[:：]|1\s*[\s.]+Introduction\b|1\s*引言\b)/i
    );

    const abstract = (end === -1
      ? remaining
      : remaining.slice(0, end))
      .replace(
        /\barXiv:\d{4}\.\d{4,5}v\d+\s*\[[^\]]+\]\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}\s*(?:--\s*)?\d+\s+of\s+\d+\s*(?:--)?/gi,
        " "
      )
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return abstract || null;
  }
