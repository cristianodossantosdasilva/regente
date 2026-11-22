import { useMemo, useState } from "react";
import { updateNode } from "../../actions";
import { t } from "../../lib/i18n";
import { renderMarkdown } from "../../lib/md";
import type { NoteNode } from "../../types";

export function NoteView({ node }: { node: NoteNode }) {
  const [preview, setPreview] = useState(false);
  const html = useMemo(() => (preview ? renderMarkdown(node.text) : ""), [preview, node.text]);
  return (
    <div className="note">
      <div className="note-bar">
        <button className={!preview ? "on" : ""} onClick={() => setPreview(false)}>
          {t("note.edit")}
        </button>
        <button className={preview ? "on" : ""} onClick={() => setPreview(true)}>
          {t("note.preview")}
        </button>
      </div>
      {preview ? (
        <div className="md scroll-ok" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <textarea value={node.text} placeholder={t("note.placeholder")} onChange={(e) => updateNode(node.id, { text: e.target.value })} spellCheck={false} />
      )}
    </div>
  );
}
