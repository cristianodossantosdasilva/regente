import { useRef, useState } from "react";
import { createAndOpenWorkspace, deleteWorkspace, exportWorkspace, focusNode, importWorkspaceFile, openWorkspace, pickDirectory, setPaused } from "../actions";
import { t } from "../lib/i18n";
import { toast, setUi, useStore } from "../store";
import type { TerminalNode } from "../types";

function Agents() {
  const ws = useStore((s) => s.ws);
  const states = useStore((s) => s.states);
  const stats = useStore((s) => s.stats);
  const alerts = useStore((s) => s.memAlerts);
  const profiles = useStore((s) => s.profiles);
  const git = useStore((s) => s.git);
  const selection = useStore((s) => s.selection);
  if (!ws) return null;
  const terms = ws.nodes.filter((n): n is TerminalNode => n.kind === "terminal");
  const totalMb = Object.values(stats).reduce((a, s) => a + s.rssBytes, 0) / 1048576;
  return (
    <div className="list">
      {terms.length === 0 && <p className="muted">{t("agent.none")}</p>}
      {terms.map((n) => {
        const p = profiles.find((x) => x.id === n.profileId);
        const st = states[n.id] ?? "idle";
        const stat = stats[n.id];
        const g = git[n.cwd || ws.root];
        return (
          <div key={n.id} className={`row ${selection === n.id ? "sel" : ""}`} onClick={() => focusNode(n.id)}>
            <span className="dot" style={{ background: p?.color }} />
            <div className="grow">
              <div className="row-title">{n.title}</div>
              <div className="muted small">
                <span className={`st-${st}`}>● {t(`agent.state.${st}`)}</span>
                {g && ` · ⎇ ${g.branch}${g.dirty ? "*" : ""}`}
              </div>
            </div>
            {stat && (
              <div className={`small mono right ${alerts[n.id] ? "warn" : "muted"}`} title={alerts[n.id] ? t("agent.memAlert") : ""}>
                {stat.cpu.toFixed(0)}%<br />
                {Math.round(stat.rssBytes / 1048576)} MB
              </div>
            )}
          </div>
        );
      })}
      {terms.length > 0 && (
        <p className="muted small">
          {t("total.mem")}: {Math.round(totalMb)} MB
        </p>
      )}
    </div>
  );
}

function Activity() {
  const activity = useStore((s) => s.activity);
  const paused = useStore((s) => s.paused);
  const ws = useStore((s) => s.ws);
  const name = (id: string) => ws?.nodes.find((n) => n.id === id)?.title ?? id;
  return (
    <div className="list">
      <button className={`pause ${paused ? "on" : ""}`} onClick={() => void setPaused(!paused)}>
        {paused ? `⏵ ${t("activity.resume")}` : `⏸ ${t("activity.pause")}`}
      </button>
      {paused && <p className="warn small">{t("activity.paused")}</p>}
      {activity.length === 0 && <p className="muted">{t("activity.none")}</p>}
      {[...activity].reverse().map((a) => (
        <div key={a.id + a.ts} className={`log k-${a.kind}`}>
          <div className="small muted">
            {new Date(a.ts).toLocaleTimeString()} · {a.kind}
            {a.depth ? ` · d${a.depth}` : ""}
          </div>
          <div>
            <b>{name(a.from)}</b> → <b>{name(a.to)}</b>
          </div>
          <div className="body">{a.body}</div>
        </div>
      ))}
    </div>
  );
}

function Workspaces() {
  const list = useStore((s) => s.list);
  const ws = useStore((s) => s.ws);
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="list">
      <div className="form">
        <b>{t("ws.new")}</b>
        <input placeholder={t("ws.name")} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="inline">
          <input placeholder={t("ws.root")} value={root} onChange={(e) => setRoot(e.target.value)} />
          <button onClick={async () => { const d = await pickDirectory(); if (d) setRoot(d); }}>{t("ws.browse")}</button>
        </div>
        <button className="primary" disabled={!name.trim()} onClick={() => void createAndOpenWorkspace(name, root).then(() => { setName(""); setRoot(""); })}>
          {t("ws.create")}
        </button>
      </div>
      <b>{t("ws.list")}</b>
      {list.map((w) => (
        <div key={w.id} className={`row ${ws?.id === w.id ? "sel" : ""}`}>
          <div className="grow" onClick={() => void openWorkspace(w.id)}>
            <div className="row-title">{w.name}</div>
            <div className="muted small">{w.root || "—"}</div>
          </div>
          <button className="icon" title={t("ws.delete")} onClick={() => confirmDelete(w.id, w.name)}>
            🗑
          </button>
        </div>
      ))}
      <div className="inline">
        <button disabled={!ws} onClick={exportWorkspace}>{t("ws.export")}</button>
        <button onClick={() => file.current?.click()}>{t("ws.import")}</button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importWorkspaceFile(f).catch((err) => toast(String(err)));
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function confirmDelete(id: string, name: string) {
  if (window.confirm(`${t("ws.delete")}: ${name}?`)) void deleteWorkspace(id);
}

export function Sidebar() {
  const tab = useStore((s) => s.ui.tab);
  const paused = useStore((s) => s.paused);
  const tabs = [
    ["agents", t("side.agents")],
    ["activity", `${t("side.activity")}${paused ? " ⏸" : ""}`],
    ["workspaces", t("side.workspaces")],
  ] as const;
  return (
    <aside className="sidebar">
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setUi({ tab: k })}>
            {label}
          </button>
        ))}
      </div>
      <div className="side-body">
        {tab === "agents" && <Agents />}
        {tab === "activity" && <Activity />}
        {tab === "workspaces" && <Workspaces />}
      </div>
    </aside>
  );
}
