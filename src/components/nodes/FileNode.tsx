import { useEffect, useMemo, useState } from "react";
import { pickFile, updateNode } from "../../actions";
import { highlight, IMAGE_EXT, MD_EXT, mimeFor } from "../../lib/highlight";
import { api } from "../../lib/ipc";
import { t } from "../../lib/i18n";
import { renderMarkdown } from "../../lib/md";
import type { FileNode } from "../../types";

/** Preview somente leitura: código com realce, imagem ou Markdown. */
export function FileView({ node }: { node: FileNode }) {
  const [content, setContent] = useState<{ kind: "code" | "md" | "img" | "err"; data: string } | null>(null);
  const [path, setPath] = useState(node.path);

  useEffect(() => {
    if (!node.path) return setContent(null);
    let cancelled = false;
    (async () => {
      try {
        if (IMAGE_EXT.test(node.path)) {
          const b64 = await api.readBase64(node.path);
          if (!cancelled) setContent({ kind: "img", data: `data:${mimeFor(node.path)};base64,${b64}` });
        } else {
          const txt = await api.readText(node.path);
          if (!cancelled) setContent({ kind: MD_EXT.test(node.path) ? "md" : "code", data: txt });
        }
      } catch (e) {
        if (!cancelled) setContent({ kind: "err", data: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [node.path]);

  const html = useMemo(() => {
    if (!content) return "";
    return content.kind === "md" ? renderMarkdown(content.data) : content.kind === "code" ? highlight(content.data) : "";
  }, [content]);

  const open = (p: string) => updateNode(node.id, { path: p, title: p.split(/[\\/]/).pop() || "Arquivo" });

  return (
    <div className="file">
      <div className="file-bar">
        <input value={path} placeholder={t("file.path")} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && open(path)} />
        <button onClick={() => open(path)}>{t("file.open")}</button>
        <button
          onClick={async () => {
            const p = await pickFile();
            if (p) {
              setPath(p);
              open(p);
            }
          }}
        >
          …
        </button>
      </div>
      <div className="file-body scroll-ok">
        {content?.kind === "img" && <img src={content.data} alt={node.title} />}
        {content?.kind === "md" && <div className="md" dangerouslySetInnerHTML={{ __html: html }} />}
        {content?.kind === "code" && <pre className="code" dangerouslySetInnerHTML={{ __html: html }} />}
        {content?.kind === "err" && <div className="err">{content.data}</div>}
      </div>
    </div>
  );
}
