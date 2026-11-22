import { useState } from "react";
import { updateNode } from "../../actions";
import { t } from "../../lib/i18n";
import type { BrowserNode } from "../../types";

/** Só localhost/127.0.0.1 (a CSP do app também restringe o frame-src). */
export const isLocalUrl = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u.trim());

export function BrowserView({ node }: { node: BrowserNode }) {
  const [url, setUrl] = useState(node.url);
  const [reload, setReload] = useState(0);
  const ok = isLocalUrl(node.url);
  return (
    <div className="file">
      <div className="file-bar">
        <input value={url} placeholder={t("browser.url")} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && updateNode(node.id, { url })} />
        <button onClick={() => (url === node.url ? setReload(reload + 1) : updateNode(node.id, { url }))}>↻</button>
      </div>
      {ok ? (
        <iframe key={reload} src={node.url} title={node.title} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
      ) : (
        <div className="err">{t("browser.invalid")}</div>
      )}
    </div>
  );
}
