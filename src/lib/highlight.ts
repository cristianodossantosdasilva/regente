const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KEYWORDS = new Set(
  (
    "abstract as async await break case catch class const continue crate def default defer delete do else enum export extends " +
    "false final finally fn for from func function go if impl import in interface is lambda let loop match mod module mut new nil " +
    "none not null of or override package private protected pub public pass raise return self static struct super switch this " +
    "throw trait true try type typeof use var void while with yield"
  ).split(" "),
);

// ordem importa: comentário de bloco, de linha, string, número, identificador
const TOKEN = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.xa-fA-F]*\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

/** Realce simples e independente de linguagem (comentários, strings, números, palavras-chave). */
export function highlight(code: string): string {
  let out = "";
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    out += escapeHtml(code.slice(last, i));
    const [tok, str, num, ident] = m;
    if (str) {
      const isComment = str.startsWith("//") || str.startsWith("/*") || str.startsWith("#");
      out += `<span class="${isComment ? "tk-c" : "tk-s"}">${escapeHtml(str)}</span>`;
    } else if (num) out += `<span class="tk-n">${escapeHtml(num)}</span>`;
    else if (ident && KEYWORDS.has(ident)) out += `<span class="tk-k">${escapeHtml(ident)}</span>`;
    else out += escapeHtml(tok);
    last = i + tok.length;
  }
  return out + escapeHtml(code.slice(last));
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;
export const MD_EXT = /\.(md|markdown)$/i;

export function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon" };
  return map[ext] ?? "application/octet-stream";
}
