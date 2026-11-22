import { useEffect } from "react";
import { addNode, addZone, bootstrap, newTerminal, onStateChanged } from "./actions";
import { Canvas } from "./components/Canvas";
import { isTypingTarget } from "./components/drag";
import { ConfirmModal, Palette, ProfilesModal, PromptModal, SearchPanel, SettingsModal } from "./components/Modals";
import { RoutinesModal } from "./components/RoutinesModal";
import { TemplatesModal } from "./components/TemplatesModal";
import { Sidebar } from "./components/Sidebar";
import { t } from "./lib/i18n";
import { getState, setUi, subscribe, useStore } from "./store";
import type { BrowserNode, DiagramNode, FileNode, NoteNode, SketchNode } from "./types";

function Toolbar() {
  const profiles = useStore((s) => s.profiles);
  const paused = useStore((s) => s.paused);
  const info = useStore((s) => s.info);
  return (
    <div className="toolbar">
      <b className="brand">{t("app.name")}</b>
      <button onClick={() => setUi({ sidebar: !getState().ui.sidebar })} title={t("cmd.toggleSidebar")}>
        ☰
      </button>
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          e.target.value = ""; // volta ao rótulo para permitir escolher o mesmo perfil de novo
          if (v) newTerminal(v);
        }}
        title={t("node.terminal")}
      >
        <option value="">＋ {t("node.terminal")}…</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button onClick={() => addNode<NoteNode>({ kind: "note", w: 380, h: 300, title: t("node.note"), text: "" })}>＋ {t("node.note")}</button>
      <button onClick={() => addNode<SketchNode>({ kind: "sketch", w: 460, h: 340, title: t("node.sketch"), shapes: [] })}>＋ {t("node.sketch")}</button>
      <button onClick={() => addNode<DiagramNode>({ kind: "diagram", w: 520, h: 360, title: t("node.diagram"), boxes: [], links: [] })}>＋ {t("node.diagram")}</button>
      <button onClick={() => addNode<FileNode>({ kind: "file", w: 520, h: 380, title: t("node.file"), path: "" })}>＋ {t("node.file")}</button>
      <button onClick={() => addNode<BrowserNode>({ kind: "browser", w: 640, h: 440, title: t("node.browser"), url: "http://localhost:3000" })}>＋ {t("node.browser")}</button>
      <button onClick={() => addZone()}>＋ {t("node.zone")}</button>
      <span className="grow" />
      {paused && <span className="chip warn">⏸ {t("activity.paused")}</span>}
      {info && !info.cliAvailable && <span className="chip warn" title={t("cli.missing")}>CLI ✕</span>}
      <button onClick={() => setUi({ search: true })} title="Ctrl+Shift+F">
        🔍
      </button>
      <button onClick={() => setUi({ palette: true })} title="Ctrl+K">
        ⌘K
      </button>
      <button onClick={() => setUi({ profiles: true })}>{t("profiles.title")}</button>
      <button onClick={() => setUi({ settings: true })}>⚙</button>
    </div>
  );
}

export function App() {
  const ws = useStore((s) => s.ws);
  const sidebar = useStore((s) => s.ui.sidebar);
  const toast = useStore((s) => s.ui.toast);

  useEffect(() => {
    void bootstrap();
    const unsub = subscribe(onStateChanged);
    const key = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setUi({ palette: true });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setUi({ search: true });
      } else if (mod && e.key.toLowerCase() === "b" && !isTypingTarget(e.target)) {
        setUi({ sidebar: !getState().ui.sidebar });
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      unsub();
      window.removeEventListener("keydown", key, true);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        {sidebar && <Sidebar />}
        <div className="stage">
          {ws ? (
            <Canvas key={ws.id} />
          ) : (
            <div className="welcome">
              <h2>{t("welcome.title")}</h2>
              <p>{t("welcome.text")}</p>
              <button className="primary" onClick={() => setUi({ sidebar: true, tab: "workspaces" })}>
                {t("ws.new")}
              </button>
            </div>
          )}
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
      <Palette />
      <SearchPanel />
      <SettingsModal />
      <ProfilesModal />
      <RoutinesModal />
      <TemplatesModal />
      <PromptModal />
      <ConfirmModal />
    </div>
  );
}
