import { AgentProfile, AnyNode, Edge, SCHEMA_VERSION, Settings, Workspace, Zone } from "../types";
import { sanitizeRoutine } from "./routines";

export const uid = (p = "n") => `${p}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontSize: 13,
  fontFamily: "Cascadia Mono, Consolas, monospace",
  scrollbackLines: 5000,
  snap: false,
  grid: 20,
  lang: "pt-BR",
  memAlertMb: 1500,
  notifications: true,
};

const common = {
  env: {} as Record<string, string>,
  resumeArgs: [] as string[],
  paste: true,
};
const ASK = ["\\(y/n\\)", "\\[y/N\\]", "do you want", "press enter", "continue\\?", "permission", "aprovar", "esperando"];

export const DEFAULT_PROFILES: AgentProfile[] = [
  { id: "shell", name: "Shell", command: "", args: [], env: {}, resumeArgs: [], waitPatterns: [], color: "#8b93a7", paste: false },
  { ...common, id: "claude", name: "Claude Code", command: "claude", args: [], resumeArgs: ["--continue"], waitPatterns: ASK, color: "#e08a5a" },
  { ...common, id: "agy", name: "Antigravity (AGY)", command: "agy", args: [], resumeArgs: ["--continue"], waitPatterns: ASK, color: "#6aa7ff" },
  { ...common, id: "kiro", name: "Kiro CLI", command: "kiro-cli", args: [], resumeArgs: ["--resume"], waitPatterns: ASK, color: "#b78cff" },
  { ...common, id: "copilot", name: "Copilot CLI", command: "copilot", args: [], resumeArgs: ["--continue"], waitPatterns: ASK, color: "#58c5a0" },
  { ...common, id: "codex", name: "Codex", command: "codex", args: [], resumeArgs: ["resume", "--last"], waitPatterns: ASK, color: "#7bd88f" },
  { ...common, id: "gemini", name: "Gemini CLI", command: "gemini", args: [], resumeArgs: ["--resume", "latest"], waitPatterns: ASK, color: "#7aa2f7" },
  { ...common, id: "opencode", name: "OpenCode", command: "opencode", args: [], resumeArgs: ["--continue"], waitPatterns: ASK, color: "#e5c07b" },
];

/** `child` está dentro de `parent` (ou é igual)? Ignora diferença de barras e de maiúsculas (Windows). */
export function isInside(child: string, parent: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const c = norm(child);
  const p = norm(parent);
  if (!c || !p || c.split("/").includes("..")) return false;
  return c === p || c.startsWith(p + "/");
}

/**
 * Endurece um workspace vindo de arquivo (não confiável): remove poderes (coordenador, teclas, papéis),
 * exige confirmação humana em todas as conexões, desliga rotinas e troca a pasta raiz por uma escolhida pelo usuário.
 */
export function hardenImported(ws: Workspace, root: string): Workspace {
  return {
    ...ws,
    root,
    nodes: ws.nodes.map((n) => {
      if (n.kind !== "terminal") return n;
      const { coordinator: _c, rolePrompt: _r, ...rest } = n;
      return { ...rest, cwd: root };
    }),
    edges: ws.edges.map(({ allowKeys: _k, ...e }) => ({ ...e, confirm: true })),
    routines: ws.routines.map((r) => ({ ...r, enabled: false })),
  };
}

export function createWorkspace(name: string, root: string): Workspace {
  return { version: SCHEMA_VERSION, id: uid("ws"), name, root, nodes: [], zones: [], edges: [], routines: [], viewport: { x: 80, y: 80, zoom: 1 } };
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

/** Valida e migra um workspace lido do disco/importado. Lança erro se o formato for irreconhecível. */
export function migrate(raw: unknown): Workspace {
  if (!raw || typeof raw !== "object") throw new Error("workspace inválido");
  const r = raw as Record<string, unknown>;
  const version = num(r.version, 0);
  if (version > SCHEMA_VERSION) throw new Error(`workspace criado por uma versão mais nova (schema ${version})`);
  const kinds = ["terminal", "note", "sketch", "diagram", "file", "browser"];
  const nodes: AnyNode[] = (Array.isArray(r.nodes) ? r.nodes : [])
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && kinds.includes((n as { kind?: string }).kind ?? ""))
    .map((n, i) => {
      const base = {
        id: str(n.id, uid()),
        x: num(n.x, 0),
        y: num(n.y, 0),
        w: Math.max(160, num(n.w, 480)),
        h: Math.max(100, num(n.h, 320)),
        z: num(n.z, i + 1),
        title: str(n.title, "Sem título"),
      };
      switch (n.kind) {
        case "terminal":
          return { ...base, kind: "terminal", profileId: str(n.profileId, "shell"), cwd: str(n.cwd), resume: n.resume === true, ...(n.coordinator === true ? { coordinator: true } : {}), ...(typeof n.rolePrompt === "string" && n.rolePrompt ? { rolePrompt: n.rolePrompt.slice(0, 4000) } : {}) };
        case "note":
          return { ...base, kind: "note", text: str(n.text) };
        case "sketch":
          return { ...base, kind: "sketch", shapes: Array.isArray(n.shapes) ? n.shapes : [] };
        case "diagram":
          return { ...base, kind: "diagram", boxes: Array.isArray(n.boxes) ? n.boxes : [], links: Array.isArray(n.links) ? n.links : [] };
        case "file":
          return { ...base, kind: "file", path: str(n.path) };
        default:
          return { ...base, kind: "browser", url: str(n.url, "http://localhost:3000") };
      }
    }) as AnyNode[];
  const ids = new Set(nodes.map((n) => n.id));
  const zones: Zone[] = (Array.isArray(r.zones) ? r.zones : []).map((z: Record<string, unknown>) => ({
    id: str(z.id, uid("z")),
    x: num(z.x, 0),
    y: num(z.y, 0),
    w: Math.max(80, num(z.w, 600)),
    h: Math.max(60, num(z.h, 400)),
    color: str(z.color, "#7c9cff"),
    title: str(z.title, "Zona"),
  }));
  const edges: Edge[] = (Array.isArray(r.edges) ? r.edges : [])
    .map((e: Record<string, unknown>) => ({
      id: str(e.id, uid("e")),
      from: str(e.from),
      to: str(e.to),
      bidirectional: e.bidirectional === true,
      confirm: e.confirm === true,
      ...(e.allowKeys === true ? { allowKeys: true } : {}),
    }))
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const vp = (r.viewport ?? {}) as Record<string, unknown>;
  return {
    version: SCHEMA_VERSION,
    id: str(r.id, uid("ws")),
    name: str(r.name, "Workspace"),
    root: str(r.root),
    nodes,
    zones,
    edges,
    routines: (Array.isArray(r.routines) ? r.routines : []).map((x) => sanitizeRoutine(x)).filter((x): x is NonNullable<typeof x> => !!x && ids.has(x.termId)),
    viewport: { x: num(vp.x, 0), y: num(vp.y, 0), zoom: Math.min(4, Math.max(0.1, num(vp.zoom, 1))) },
  };
}

export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "nota";

/** Define a aresta de orquestração respeitando os tipos: ao menos uma ponta é terminal. */
export function canConnect(a: AnyNode | undefined, b: AnyNode | undefined): boolean {
  if (!a || !b || a.id === b.id) return false;
  const ok = (n: AnyNode) => n.kind === "terminal" || n.kind === "note";
  return ok(a) && ok(b) && (a.kind === "terminal" || b.kind === "terminal");
}

/** Normaliza para que terminais fiquem na ponta `from` quando a ligação for terminal↔nota. */
export function normalizeEdge(a: AnyNode, b: AnyNode): { from: string; to: string } {
  if (a.kind === "note" && b.kind === "terminal") return { from: b.id, to: a.id };
  return { from: a.id, to: b.id };
}
