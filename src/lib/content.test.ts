import { describe, expect, it } from "vitest";
import { highlight, mimeFor } from "./highlight";
import { renderMarkdown, safeHref } from "./md";

describe("markdown seguro", () => {
  it("descarta HTML cru e scripts", () => {
    const html = renderMarkdown("# Oi\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
    expect(html).toContain("<h1");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
  it("bloqueia links javascript:", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
    expect(renderMarkdown("[ok](https://exemplo.com)")).toContain('href="https://exemplo.com"');
    expect(safeHref("data:text/html,x")).toBe(false);
  });
});

describe("highlight", () => {
  it("escapa HTML e marca tokens", () => {
    const h = highlight('const a = "<b>"; // x\nlet n = 42');
    expect(h).toContain('<span class="tk-k">const</span>');
    expect(h).toContain('<span class="tk-s">"&lt;b&gt;"</span>');
    expect(h).toContain('<span class="tk-c">// x</span>');
    expect(h).toContain('<span class="tk-n">42</span>');
    expect(h).not.toContain("<b>");
  });
  it("mime por extensão", () => expect(mimeFor("a/B.PNG")).toBe("image/png"));
});
