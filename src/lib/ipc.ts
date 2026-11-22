import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Edge, LogEntry, TermStat, WsEntry } from "../types";

export interface AppInfo {
  dataDir: string;
  cliDir: string | null;
  pipe: string;
  version: string;
  cliAvailable: boolean;
  defaultShell: string;
  home: string;
}

export interface SpawnReq {
  id: string;
  program: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  scrollbackBytes?: number;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  spawn: (spec: SpawnReq) => invoke<{ pid: number | null }>("pty_spawn", { spec }),
  write: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  resize: (id: string, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  kill: (id: string) => invoke<void>("pty_kill", { id }),
  setStreaming: (id: string, on: boolean) => invoke<void>("pty_set_streaming", { id, on }),
  replay: (id: string) => invoke<{ data: string; end: number; exitCode: number | null }>("pty_replay", { id }),
  stats: () => invoke<TermStat[]>("pty_stats"),
  searchOutput: (query: string) => invoke<{ id: string; line: string }[]>("search_output", { query }),
  orchSync: (terms: unknown[], notes: unknown[], edges: Edge[]) => invoke<void>("orch_sync", { terms, notes, edges }),
  orchResetDepth: (id: string) => invoke<void>("orch_reset_depth", { id }),
  orchSetStates: (states: Record<string, string>) => invoke<void>("orch_set_states", { states }),
  coordAnswer: (id: string, ok: boolean, result: unknown, error: string | null) => invoke<void>("coord_answer", { id, ok, result, error }),
  routineFire: (term: string, title: string, text: string, preRun: string | null, cwd: string | null, reminder: boolean) =>
    invoke<string>("routine_fire", { term, title, text, preRun, cwd, reminder }),
  orchPause: (paused: boolean) => invoke<void>("orch_set_paused", { paused }),
  orchLog: () => invoke<LogEntry[]>("orch_log"),
  confirmAnswer: (id: string, allow: boolean) => invoke<void>("confirm_answer", { id, allow }),
  wsList: () => invoke<WsEntry[]>("ws_list"),
  wsLoad: (id: string) => invoke<{ text: string; recovered: boolean }>("ws_load", { id }),
  wsSave: (id: string, text: string) => invoke<void>("ws_save", { id, text }),
  wsDelete: (id: string) => invoke<void>("ws_delete", { id }),
  configLoad: (name: string) => invoke<string | null>("config_load", { name }),
  configSave: (name: string, text: string) => invoke<void>("config_save", { name, text }),
  readText: (path: string) => invoke<string>("fs_read_text", { path }),
  readBase64: (path: string) => invoke<string>("fs_read_base64", { path }),
  writeContext: (root: string, rel: string, text: string) => invoke<void>("fs_write_context", { root, rel, text }),
  detect: (names: string[]) => invoke<Record<string, string | null>>("detect_commands", { names }),
  gitInfo: (cwd: string) => invoke<{ branch: string; dirty: boolean } | null>("git_info", { cwd }),
  worktreeAdd: (cwd: string, name: string) => invoke<string>("git_worktree_add", { cwd, name }),
};

// ---- Roteador de saída de PTY: um único listener para todos os terminais ----

export interface PtyChunk {
  id: string;
  start: number;
  data: string;
}
type ChunkHandler = (c: PtyChunk) => void;
const handlers = new Map<string, Set<ChunkHandler>>();
let started: Promise<UnlistenFn> | null = null;

export function ensurePtyRouter() {
  if (!started) {
    started = listen<PtyChunk>("pty-output", (e) => {
      handlers.get(e.payload.id)?.forEach((h) => h(e.payload));
    });
  }
}

export function subscribePty(id: string, h: ChunkHandler): () => void {
  ensurePtyRouter();
  let set = handlers.get(id);
  if (!set) handlers.set(id, (set = new Set()));
  set.add(h);
  return () => {
    set!.delete(h);
    if (set!.size === 0) handlers.delete(id);
  };
}

export const on = <T>(event: string, cb: (payload: T) => void) => listen<T>(event, (e) => cb(e.payload));
