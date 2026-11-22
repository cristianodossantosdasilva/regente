import { useSyncExternalStore } from "react";
import type { AgentProfile, AgentState, LogEntry, Settings, TermStat, Workspace, WsEntry, TeamTemplate } from "./types";
import { DEFAULT_PROFILES, DEFAULT_SETTINGS } from "./lib/workspace";
import type { AppInfo } from "./lib/ipc";

export interface WorkInfo {
  text: string;
  state: "working" | "blocked" | "review" | "done";
  progress?: string | null;
}

export interface ConfirmReq {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  body: string;
}

export interface Ui {
  sidebar: boolean;
  palette: boolean;
  search: boolean;
  settings: boolean;
  profiles: boolean;
  routines: boolean;
  templates: boolean;
  tab: "agents" | "activity" | "workspaces";
  prompt: { title: string; initial: string; resolve: (v: string | null) => void } | null;
  toast: string | null;
}

export interface State {
  ws: Workspace | null;
  list: WsEntry[];
  info: AppInfo | null;
  settings: Settings;
  profiles: AgentProfile[];
  selection: string | null;
  selEdge: string | null;
  stats: Record<string, TermStat>;
  states: Record<string, AgentState>;
  git: Record<string, { branch: string; dirty: boolean } | null>;
  memAlerts: Record<string, boolean>;
  /** Status de trabalho publicado por cada terminal (`regente status`). */
  work: Record<string, WorkInfo>;
  templates: TeamTemplate[];
  activity: LogEntry[];
  paused: boolean;
  confirm: ConfirmReq | null;
  ui: Ui;
  /** Incrementa para forçar o front a reiniciar um terminal específico. */
  restartTick: Record<string, number>;
  /** Nós visíveis na tela (usado para dormência). */
  size: { w: number; h: number };
}

const initial: State = {
  ws: null,
  list: [],
  info: null,
  settings: DEFAULT_SETTINGS,
  profiles: DEFAULT_PROFILES,
  selection: null,
  selEdge: null,
  stats: {},
  states: {},
  git: {},
  memAlerts: {},
  work: {},
  templates: [],
  activity: [],
  paused: false,
  confirm: null,
  ui: { sidebar: true, palette: false, search: false, settings: false, profiles: false, routines: false, templates: false, tab: "agents", prompt: null, toast: null },
  restartTick: {},
  size: { w: 1200, h: 800 },
};

let state = initial;
const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: State) => T): T {
  const snap = () => selector(state);
  return useSyncExternalStore(subscribe, snap, snap);
}

export const setUi = (p: Partial<Ui>) => setState((s) => ({ ui: { ...s.ui, ...p } }));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  setUi({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setUi({ toast: null }), 4500);
}

/** Pede um texto ao usuário (substitui window.prompt, que não é confiável no WebView). */
export function askText(title: string, initialValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    setUi({
      prompt: {
        title,
        initial: initialValue,
        resolve: (v) => {
          setUi({ prompt: null });
          resolve(v);
        },
      },
    });
  });
}
