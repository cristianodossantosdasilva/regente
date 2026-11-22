import { useState } from "react";
import { deleteTemplate, insertTemplate, saveCurrentAsTemplate } from "../actions";
import { t } from "../lib/i18n";
import { setUi, useStore } from "../store";
import { Modal } from "./Modals";

/** Salva o desenho atual (terminais, notas e conexões) como template e insere templates no canvas. */
export function TemplatesModal() {
  const open = useStore((s) => s.ui.templates);
  const templates = useStore((s) => s.templates);
  const ws = useStore((s) => s.ws);
  const [name, setName] = useState("");
  if (!open) return null;
  return (
    <Modal title={t("tpl.title")} onClose={() => setUi({ templates: false })} wide>
      <div className="routine-list">
        {templates.length === 0 && <p className="muted">{t("tpl.empty")}</p>}
        {templates.map((tp) => (
          <div key={tp.id} className="routine-row">
            <div className="routine-info">
              <b>{tp.name}</b>
              <div className="muted">
                {t("tpl.counts", { agents: tp.nodes.filter((n) => n.kind === "terminal").length, notes: tp.nodes.filter((n) => n.kind === "note").length, links: tp.edges.length })}
              </div>
            </div>
            <button className="primary" disabled={!ws} onClick={() => void insertTemplate(tp.id)}>
              {t("tpl.insert")}
            </button>
            <button onClick={() => void deleteTemplate(tp.id)}>{t("routine.delete")}</button>
          </div>
        ))}
      </div>
      <h4>{t("tpl.saveTitle")}</h4>
      <p className="muted">{t("tpl.saveHint")}</p>
      <div className="form">
        <label>
          {t("routine.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          className="primary"
          disabled={!ws || !name.trim()}
          onClick={() => {
            void saveCurrentAsTemplate(name);
            setName("");
          }}
        >
          {t("tpl.save")}
        </button>
      </div>
    </Modal>
  );
}
