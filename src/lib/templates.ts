import type { AnyNode, Edge, NoteNode, TeamTemplate, TemplateNode, TerminalNode, Workspace } from "../types";
import { uid } from "./workspace";

const MAX_TEMPLATES = 50;

/** Captura terminais e notas (e as conexões entre eles) como um template reutilizável. Posições ficam relativas. */
export function captureTemplate(ws: Workspace, name: string, only?: Set<string>): TeamTemplate | null {
  const nodes = ws.nodes.filter((n): n is TerminalNode | NoteNode => (n.kind === "terminal" || n.kind === "note") && (!only || only.has(n.id)));
  if (!nodes.length) return null;
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const tnodes: TemplateNode[] = nodes.map((n) =>
    n.kind === "terminal"
      ? { kind: "terminal", title: n.title, profileId: n.profileId, dx: n.x - minX, dy: n.y - minY, w: n.w, h: n.h, ...(n.coordinator ? { coordinator: true } : {}), ...(n.rolePrompt ? { prompt: n.rolePrompt } : {}) }
      : { kind: "note", title: n.title, text: n.text, dx: n.x - minX, dy: n.y - minY, w: n.w, h: n.h },
  );
  const edges = ws.edges
    .filter((e) => index.has(e.from) && index.has(e.to))
    .map((e) => ({ from: index.get(e.from)!, to: index.get(e.to)!, bidirectional: e.bidirectional, confirm: e.confirm, ...(e.allowKeys ? { allowKeys: true } : {}) }));
  return { id: uid("tpl"), name: name.trim().slice(0, 80) || "Equipe", createdAt: Date.now(), nodes: tnodes, edges };
}

/** Largura/altura do conjunto, para achar um espaço livre no canvas. */
export function templateSize(tpl: TeamTemplate): { w: number; h: number } {
  return { w: Math.max(...tpl.nodes.map((n) => n.dx + n.w)), h: Math.max(...tpl.nodes.map((n) => n.dy + n.h)) };
}

/** Gera os nós/arestas novos (ids novos, títulos únicos) a partir do template. `prompts` = instruções iniciais dos agentes. */
export function instantiateTemplate(
  tpl: TeamTemplate,
  origin: { x: number; y: number },
  cwd: string,
  zStart: number,
  existingTitles: Iterable<string>,
): { nodes: AnyNode[]; edges: Edge[]; prompts: { id: string; text: string; profileId: string }[] } {
  const used = new Set([...existingTitles].map((t) => t.toLowerCase()));
  const unique = (title: string) => {
    let t = title;
    for (let i = 2; used.has(t.toLowerCase()); i++) t = `${title} ${i}`;
    used.add(t.toLowerCase());
    return t;
  };
  const prompts: { id: string; text: string; profileId: string }[] = [];
  const nodes: AnyNode[] = tpl.nodes.map((n, i) => {
    const base = { id: uid("n"), x: origin.x + n.dx, y: origin.y + n.dy, w: n.w, h: n.h, z: zStart + i + 1, title: unique(n.title) };
    if (n.kind === "note") return { ...base, kind: "note", text: n.text } as NoteNode;
    if (n.prompt) prompts.push({ id: base.id, text: n.prompt, profileId: n.profileId });
    return { ...base, kind: "terminal", profileId: n.profileId, cwd, resume: false, ...(n.coordinator ? { coordinator: true } : {}), ...(n.prompt ? { rolePrompt: n.prompt } : {}) } as TerminalNode;
  });
  const edges: Edge[] = tpl.edges
    .filter((e) => nodes[e.from] && nodes[e.to])
    .map((e) => ({ id: uid("e"), from: nodes[e.from].id, to: nodes[e.to].id, bidirectional: e.bidirectional, confirm: e.confirm, ...(e.allowKeys ? { allowKeys: true } : {}) }));
  return { nodes, edges, prompts };
}

/** Valida templates lidos de disco: descarta lixo, limita tamanhos e quantidade. */
export function sanitizeTemplates(raw: unknown): TeamTemplate[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const out: TeamTemplate[] = [];
  for (const t of raw.slice(0, MAX_TEMPLATES)) {
    if (!t || typeof t !== "object" || !Array.isArray((t as TeamTemplate).nodes)) continue;
    const nodes: TemplateNode[] = [];
    for (const n of (t as TeamTemplate).nodes.slice(0, 40) as unknown as Record<string, unknown>[]) {
      if (!n || (n.kind !== "terminal" && n.kind !== "note")) continue;
      const geo = { title: str(n.title, "Sem título").slice(0, 80), dx: num(n.dx, 0), dy: num(n.dy, 0), w: Math.max(160, num(n.w, 480)), h: Math.max(100, num(n.h, 320)) };
      if (n.kind === "note") nodes.push({ kind: "note", text: str(n.text).slice(0, 20000), ...geo });
      else nodes.push({ kind: "terminal", profileId: str(n.profileId, "shell"), ...geo, ...(n.coordinator === true ? { coordinator: true } : {}), ...(str(n.prompt) ? { prompt: str(n.prompt).slice(0, 4000) } : {}) });
    }
    if (!nodes.length) continue;
    const edges = ((t as TeamTemplate).edges ?? [])
      .map((e) => ({ from: num(e.from, -1), to: num(e.to, -1), bidirectional: e.bidirectional === true, confirm: e.confirm === true, ...(e.allowKeys === true ? { allowKeys: true } : {}) }))
      .filter((e) => Number.isInteger(e.from) && Number.isInteger(e.to) && e.from !== e.to && e.from >= 0 && e.to >= 0 && e.from < nodes.length && e.to < nodes.length);
    out.push({ id: str((t as TeamTemplate).id, uid("tpl")), name: str((t as TeamTemplate).name, "Equipe").slice(0, 80), createdAt: num((t as TeamTemplate).createdAt, Date.now()), nodes, edges });
  }
  return out;
}
