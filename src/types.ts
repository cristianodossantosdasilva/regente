export const SCHEMA_VERSION = 1;

export type NodeKind = "terminal" | "note" | "sketch" | "diagram" | "file" | "browser";

export interface BaseNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  title: string;
}

export interface TerminalNode extends BaseNode {
  kind: "terminal";
  profileId: string;
  cwd: string;
  /** Retoma a sessão do agente (usa `resumeArgs` do perfil) ao relançar. */
  resume: boolean;
  /** Pode recrutar/conectar/dispensar agentes por CLI (`regente recruit/connect/dismiss`). */
  coordinator?: boolean;
  /** Papel/instrução inicial do agente (enviada ao inserir a partir de um template ou por comando). */
  rolePrompt?: string;
}
export interface NoteNode extends BaseNode {
  kind: "note";
  text: string;
}
export type Shape =
  | { t: "pen"; pts: number[]; c: string }
  | { t: "rect"; x: number; y: number; w: number; h: number; c: string }
  | { t: "arrow"; x1: number; y1: number; x2: number; y2: number; c: string }
  | { t: "text"; x: number; y: number; text: string; c: string };
export interface SketchNode extends BaseNode {
  kind: "sketch";
  shapes: Shape[];
}
export interface DiagramBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}
export interface DiagramNode extends BaseNode {
  kind: "diagram";
  boxes: DiagramBox[];
  links: { from: string; to: string }[];
}
export interface FileNode extends BaseNode {
  kind: "file";
  path: string;
}
export interface BrowserNode extends BaseNode {
  kind: "browser";
  url: string;
}
export type AnyNode = TerminalNode | NoteNode | SketchNode | DiagramNode | FileNode | BrowserNode;

export interface Zone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  title: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  bidirectional: boolean;
  confirm: boolean;
  /** Permite `regente keys` (teclas cruas) de `from` para `to`. */
  allowKeys?: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Prompt recorrente enviado a um agente (ou lembrete ao usuário). Só a interface cria rotinas; agentes não têm acesso. */
export interface Routine {
  id: string;
  /** Terminal-alvo. */
  termId: string;
  title: string;
  /** Texto enviado ao agente; `{{output}}` é substituído pela saída da pré-execução. */
  text: string;
  kind: "every" | "daily" | "weekly" | "once";
  everyMin?: number;
  /** "HH:MM" (diária/semanal). */
  time?: string;
  /** 0 = domingo … 6 (semanal). */
  weekday?: number;
  /** Epoch ms (única). */
  at?: number;
  enabled: boolean;
  /** Comando PowerShell executado antes; sem saída ou com erro = a rotina não dispara. */
  preRun?: string;
  /** Apenas notifica o usuário, sem enviar ao agente. */
  reminder?: boolean;
  maxRuns?: number;
  runs: number;
  lastRun?: number;
  createdAt: number;
}

export type TemplateNode =
  | { kind: "terminal"; title: string; profileId: string; dx: number; dy: number; w: number; h: number; coordinator?: boolean; prompt?: string }
  | { kind: "note"; title: string; text: string; dx: number; dy: number; w: number; h: number };

/** Equipe reutilizável: agentes, notas e conexões com posições relativas. */
export interface TeamTemplate {
  id: string;
  name: string;
  createdAt: number;
  nodes: TemplateNode[];
  edges: { from: number; to: number; bidirectional: boolean; confirm: boolean; allowKeys?: boolean }[];
}

export interface Workspace {
  version: number;
  id: string;
  name: string;
  root: string;
  nodes: AnyNode[];
  zones: Zone[];
  edges: Edge[];
  routines: Routine[];
  viewport: Viewport;
}

export interface AgentProfile {
  id: string;
  name: string;
  /** Vazio = shell puro. */
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Argumentos extras ao retomar a sessão (ex.: ["--continue"]). */
  resumeArgs: string[];
  /** Regexes (texto) que indicam "aguardando entrada" no fim da saída. */
  waitPatterns: string[];
  color: string;
  /** Injeção de mensagens por bracketed paste (agentes TUI). */
  paste: boolean;
}

export interface Settings {
  theme: "dark" | "light";
  fontSize: number;
  fontFamily: string;
  scrollbackLines: number;
  snap: boolean;
  grid: number;
  lang: "pt-BR" | "en";
  memAlertMb: number;
  notifications: boolean;
}

export type AgentState = "idle" | "working" | "waiting" | "error" | "exited";

export interface TermStat {
  id: string;
  pid: number | null;
  alive: boolean;
  exitCode: number | null;
  cpu: number;
  rssBytes: number;
  idleMs: number;
  ringBytes: number;
  tail: string;
}

export interface LogEntry {
  id: string;
  ts: number;
  kind: string;
  from: string;
  to: string;
  depth: number;
  body: string;
}

export interface WsEntry {
  id: string;
  name: string;
  root: string;
  updatedMs: number;
}
