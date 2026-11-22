import { marked } from "marked";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Só permite links http(s), mailto e relativos; bloqueia javascript:, data: etc. */
export const safeHref = (href: string) => /^(https?:|mailto:|#|\/|\.)/i.test(href.trim());

marked.use({
  renderer: {
    // HTML cru do Markdown é descartado (notas podem ser escritas por agentes).
    html: () => "",
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!safeHref(href)) return text;
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image: ({ text }) => escapeHtml(text),
  },
});

export function renderMarkdown(src: string): string {
  return marked.parse(src, { async: false, gfm: true, breaks: true }) as string;
}
