import { useState } from "react";
import { addRoutine, fireRoutine, removeRoutine, updateRoutine } from "../actions";
import { t } from "../lib/i18n";
import { nextRun } from "../lib/routines";
import { setUi, useStore } from "../store";
import type { Routine, TerminalNode } from "../types";
import { Modal } from "./Modals";

const fmt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : t("routine.never"));

function schedule(r: Routine): string {
  switch (r.kind) {
    case "every":
      return `${t("routine.kind.every").replace("N", String(r.everyMin ?? 60))}`;
    case "daily":
      return `${t("routine.kind.daily")} ${r.time}`;
    case "weekly":
      return `${t(`routine.sev.${r.weekday ?? 1}`)} ${r.time}`;
    case "once":
      return `${t("routine.kind.once")} ${fmt(r.at)}`;
  }
}

/** Gerencia rotinas do workspace aberto. Só a interface cria rotinas: agentes não têm acesso a esta função. */
export function RoutinesModal() {
  const open = useStore((s) => s.ui.routines);
  const ws = useStore((s) => s.ws);
  const [f, setF] = useState({ title: "", termId: "", text: "", kind: "every" as Routine["kind"], everyMin: 60, time: "09:00", weekday: 1, at: "", preRun: "", reminder: false, maxRuns: "" });
  if (!open || !ws) return null;
  const terms = ws.nodes.filter((n): n is TerminalNode => n.kind === "terminal");
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const termId = f.termId || terms[0]?.id || "";
  const atMs = f.at ? new Date(f.at).getTime() : undefined;
  const valid = !!termId && f.text.trim() !== "" && (f.kind !== "once" || !!atMs);

  const add = () => {
    if (!valid) return;
    addRoutine({
      termId,
      title: f.title.trim() || t("routine.new"),
      text: f.text,
      kind: f.kind,
      everyMin: Math.max(1, f.everyMin || 60),
      time: f.time,
      weekday: f.weekday,
      at: atMs,
      enabled: true,
      preRun: f.preRun.trim() || undefined,
      reminder: f.reminder,
      maxRuns: Number(f.maxRuns) > 0 ? Math.floor(Number(f.maxRuns)) : undefined,
    });
    set({ title: "", text: "", preRun: "", maxRuns: "" });
  };

  return (
    <Modal title={t("routine.title")} onClose={() => setUi({ routines: false })} wide>
      <p className="muted">{t("routine.onlyOpen")}</p>
      <div className="routine-list">
        {ws.routines.length === 0 && <p className="muted">{t("routine.empty")}</p>}
        {ws.routines.map((r) => {
          const target = terms.find((n) => n.id === r.termId)?.title ?? "?";
          return (
            <div key={r.id} className="routine-row">
              <label className="check" title={r.enabled ? "on" : "off"}>
                <input type="checkbox" checked={r.enabled} onChange={(e) => updateRoutine(r.id, { enabled: e.target.checked })} />
              </label>
              <div className="routine-info">
                <b>{r.title}</b> → {target}
                {r.reminder ? " 🔔" : ""}
                {r.preRun ? " ⚙" : ""}
                <div className="muted">
                  {schedule(r)} · {t("routine.next")}: {fmt(nextRun(r, new Date()))} · {r.runs} {t("routine.runs")}
                  {r.maxRuns ? `/${r.maxRuns}` : ""}
                </div>
              </div>
              <button onClick={() => void fireRoutine(r.id)}>{t("routine.runNow")}</button>
              <button onClick={() => removeRoutine(r.id)}>{t("routine.delete")}</button>
            </div>
          );
        })}
      </div>
      <h4>{t("routine.new")}</h4>
      {terms.length === 0 ? (
        <p className="muted">{t("routine.noTerminal")}</p>
      ) : (
        <div className="form">
          <label>
            {t("routine.name")}
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label>
            {t("routine.target")}
            <select value={termId} onChange={(e) => set({ termId: e.target.value })}>
              {terms.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("routine.text")}
            <textarea rows={3} value={f.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <label>
            {t("routine.kind")}
            <select value={f.kind} onChange={(e) => set({ kind: e.target.value as Routine["kind"] })}>
              {(["every", "daily", "weekly", "once"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`routine.kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          {f.kind === "every" && (
            <label>
              {t("routine.everyMin")}
              <input type="number" min={1} value={f.everyMin} onChange={(e) => set({ everyMin: Number(e.target.value) })} />
            </label>
          )}
          {(f.kind === "daily" || f.kind === "weekly") && (
            <label>
              {t("routine.time")}
              <input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} />
            </label>
          )}
          {f.kind === "weekly" && (
            <label>
              {t("routine.weekday")}
              <select value={f.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {t(`routine.sev.${d}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {f.kind === "once" && (
            <label>
              {t("routine.at")}
              <input type="datetime-local" value={f.at} onChange={(e) => set({ at: e.target.value })} />
            </label>
          )}
          <label>
            {t("routine.preRun")}
            <input value={f.preRun} onChange={(e) => set({ preRun: e.target.value })} placeholder="git status --porcelain" />
          </label>
          <label>
            {t("routine.maxRuns")}
            <input type="number" min={1} value={f.maxRuns} onChange={(e) => set({ maxRuns: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={f.reminder} onChange={(e) => set({ reminder: e.target.checked })} /> {t("routine.reminder")}
          </label>
          <button className="primary" disabled={!valid} onClick={add}>
            {t("routine.add")}
          </button>
        </div>
      )}
    </Modal>
  );
}
