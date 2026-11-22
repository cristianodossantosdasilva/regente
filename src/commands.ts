import { addNode, addZone, createWorktreeFor, fitAll, newTerminal, saveSettings, setPaused, setRolePrompt, setViewport, updateNode } from "./actions";
import { t } from "./lib/i18n";
import { getState, setUi } from "./store";
import type { BrowserNode, DiagramNode, FileNode, NoteNode, SketchNode } from "./types";

export interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

/** Comandos disponíveis na paleta (Ctrl/⌘+K). */
export function buildCommands(): Command[] {
  const s = getState();
  const hasWs = !!s.ws;
  const cmds: Command[] = [];
  if (hasWs) {
    for (const p of s.profiles) cmds.push({ id: `term-${p.id}`, title: t("cmd.newTerminal", { name: p.name }), run: () => void newTerminal(p.id) });
    cmds.push(
      { id: "note", title: t("cmd.newNote"), run: () => addNode<NoteNode>({ kind: "note", w: 380, h: 300, title: t("node.note"), text: "" }) },
      { id: "sketch", title: t("cmd.newSketch"), run: () => addNode<SketchNode>({ kind: "sketch", w: 460, h: 340, title: t("node.sketch"), shapes: [] }) },
      { id: "diagram", title: t("cmd.newDiagram"), run: () => addNode<DiagramNode>({ kind: "diagram", w: 520, h: 360, title: t("node.diagram"), boxes: [], links: [] }) },
      { id: "file", title: t("cmd.newFile"), run: () => addNode<FileNode>({ kind: "file", w: 520, h: 380, title: t("node.file"), path: "" }) },
      { id: "browser", title: t("cmd.newBrowser"), run: () => addNode<BrowserNode>({ kind: "browser", w: 640, h: 440, title: t("node.browser"), url: "http://localhost:3000" }) },
      { id: "zone", title: t("cmd.newZone"), run: () => addZone() },
      { id: "fit", title: t("cmd.fit"), hint: "Ctrl+1", run: fitAll },
      { id: "reset", title: t("cmd.reset"), hint: "Ctrl+0", run: () => setViewport({ ...getState().ws!.viewport, zoom: 1 }) },
      {
        id: "worktree",
        title: t("cmd.worktree"),
        run: () => {
          const sel = getState().selection;
          if (sel) void createWorktreeFor(sel);
        },
      },
      {
        id: "coordinator",
        title: t("cmd.coordinator"),
        run: () => {
          const st = getState();
          const n = st.ws?.nodes.find((x) => x.id === st.selection);
          if (n && n.kind === "terminal") updateNode(n.id, { coordinator: !n.coordinator });
        },
      },
      { id: "templates", title: t("cmd.templates"), run: () => setUi({ templates: true }) },
      {
        id: "role",
        title: t("cmd.role"),
        run: () => {
          const st = getState();
          const n = st.ws?.nodes.find((x) => x.id === st.selection);
          if (n && n.kind === "terminal") void setRolePrompt(n.id);
        },
      },
      { id: "routines", title: t("cmd.routines"), run: () => setUi({ routines: true }) },
      { id: "pause", title: t("cmd.pause"), run: () => void setPaused(!getState().paused) },
    );
  }
  cmds.push(
    { id: "sidebar", title: t("cmd.toggleSidebar"), run: () => setUi({ sidebar: !getState().ui.sidebar }) },
    { id: "theme", title: t("cmd.toggleTheme"), run: () => void saveSettings({ ...getState().settings, theme: getState().settings.theme === "dark" ? "light" : "dark" }) },
    { id: "search", title: t("cmd.search"), hint: "Ctrl+Shift+F", run: () => setUi({ search: true }) },
    { id: "settings", title: t("cmd.settings"), run: () => setUi({ settings: true }) },
    { id: "profiles", title: t("cmd.profiles"), run: () => setUi({ profiles: true }) },
    { id: "workspaces", title: t("cmd.workspaces"), run: () => setUi({ sidebar: true, tab: "workspaces" }) },
  );
  return cmds;
}

/** Busca "fuzzy" simples: todas as palavras da consulta precisam aparecer (sem acento/caixa). */
export function matches(text: string, query: string): boolean {
  const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const target = norm(text);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => target.includes(w));
}
