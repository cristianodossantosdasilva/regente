import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { askText, getState, setState, setUi, toast } from "./store";
import { api, on } from "./lib/ipc";
import { compilePatterns, computeState } from "./lib/agentState";
import { centerOn, fitViewport, isFullyVisible, placeNear, Rect, MAX_ZOOM, MIN_ZOOM, clamp } from "./lib/geometry";
import { setLang, t } from "./lib/i18n";
import { canConnect, createWorkspace, DEFAULT_PROFILES, DEFAULT_SETTINGS, hardenImported, isInside, migrate, normalizeEdge, slug, uid } from "./lib/workspace";
import { isDue } from "./lib/routines";
import { captureTemplate, instantiateTemplate, sanitizeTemplates, templateSize } from "./lib/templates";
import type { AgentProfile, AnyNode, LogEntry, Routine, Settings, TerminalNode, Workspace, Zone } from "./types";

// ---------- helpers de estado ----------

export function mutateWs(fn: (ws: Workspace) => Workspace) {
  setState((s) => (s.ws ? { ws: fn(s.ws) } : {}));
}

const maxZ = (ws: Workspace) => ws.nodes.reduce((m, n) => Math.max(m, n.z), 0);

export function viewCenterWorld() {
  const { ws, size } = getState();
  if (!ws) return { x: 0, y: 0 };
  const v = ws.viewport;
  return { x: (size.w / 2 - v.x) / v.zoom, y: (size.h / 2 - v.y) / v.zoom };
}

export function addNode<T extends AnyNode>(partial: Omit<T, "id" | "z" | "x" | "y"> & { x?: number; y?: number }): string {
  const id = uid("n");
  const c = viewCenterWorld();
  mutateWs((ws) => {
    const spot = placeNear(ws.nodes, partial.w, partial.h, c.x, c.y);
    const node = { ...partial, id, z: maxZ(ws) + 1, x: partial.x ?? spot.x, y: partial.y ?? spot.y } as unknown as AnyNode;
    return { ...ws, nodes: [...ws.nodes, node] };
  });
  setState({ selection: id });
  // Nó novo fora da tela? Traz para a vista (mantendo o zoom).
  const { ws, size } = getState();
  const n = ws?.nodes.find((x) => x.id === id);
  if (ws && n && !isFullyVisible(n, ws.viewport, size.w, size.h)) setViewport(centerOn(n, ws.viewport, size.w, size.h));
  return id;
}

export function updateNode(id: string, patch: Partial<AnyNode>) {
  mutateWs((ws) => ({ ...ws, nodes: ws.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as AnyNode) : n)) }));
}

export function removeNode(id: string) {
  mutateWs((ws) => ({ ...ws, nodes: ws.nodes.filter((n) => n.id !== id), edges: ws.edges.filter((e) => e.from !== id && e.to !== id) }));
  if (getState().selection === id) setState({ selection: null });
}

export function bringToFront(id: string) {
  const ws = getState().ws;
  if (!ws) return;
  const n = ws.nodes.find((x) => x.id === id);
  if (!n || n.z === maxZ(ws)) return;
  updateNode(id, { z: maxZ(ws) + 1 });
}

export function addZone(partial?: Partial<Zone>) {
  const c = viewCenterWorld();
  const colors = ["#7c9cff", "#ffb454", "#7bd88f", "#ff7a90", "#b78cff"];
  mutateWs((ws) => ({
    ...ws,
    zones: [...ws.zones, { id: uid("z"), x: c.x - 400, y: c.y - 250, w: 800, h: 500, color: colors[ws.zones.length % colors.length], title: t("node.zone"), ...partial }],
  }));
}

export function addEdge(aId: string, bId: string) {
  const ws = getState().ws;
  if (!ws) return;
  const a = ws.nodes.find((n) => n.id === aId);
  const b = ws.nodes.find((n) => n.id === bId);
  if (!a || !b || !canConnect(a, b)) return;
  const { from, to } = normalizeEdge(a, b);
  if (ws.edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return;
  mutateWs((w) => ({ ...w, edges: [...w.edges, { id: uid("e"), from, to, bidirectional: false, confirm: false }] }));
}

export function updateEdge(id: string, patch: Partial<{ bidirectional: boolean; confirm: boolean; allowKeys: boolean }>) {
  mutateWs((ws) => ({ ...ws, edges: ws.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
}

export function removeEdge(id: string) {
  mutateWs((ws) => ({ ...ws, edges: ws.edges.filter((e) => e.id !== id) }));
  setState({ selEdge: null });
}

export function setViewport(v: { x: number; y: number; zoom: number }) {
  mutateWs((ws) => ({ ...ws, viewport: { ...v, zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM) } }));
}

export function fitAll() {
  const { ws, size } = getState();
  if (!ws) return;
  const rects: Rect[] = [...ws.nodes, ...ws.zones];
  setViewport(fitViewport(rects, size.w, size.h));
}

export function focusNode(id: string) {
  const { ws, size } = getState();
  const n = ws?.nodes.find((x) => x.id === id);
  if (!ws || !n) return;
  setViewport(centerOn(n, ws.viewport, size.w, size.h));
  setState({ selection: id });
  bringToFront(id);
}

export function profileOf(id: string): AgentProfile {
  const { profiles } = getState();
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? DEFAULT_PROFILES[0];
}

export function newTerminal(profileId: string, opts: Partial<TerminalNode> = {}) {
  const ws = getState().ws;
  if (!ws) return;
  const p = profileOf(profileId);
  const count = ws.nodes.filter((n) => n.kind === "terminal" && (n as TerminalNode).profileId === p.id).length;
  return addNode<TerminalNode>({
    kind: "terminal",
    w: 640,
    h: 400,
    title: count ? `${p.name} ${count + 1}` : p.name,
    profileId: p.id,
    cwd: ws.root,
    resume: false,
    ...opts,
  });
}

export async function createWorktreeFor(id: string) {
  const ws = getState().ws;
  const n = ws?.nodes.find((x) => x.id === id);
  if (!ws || !n || n.kind !== "terminal") return;
  const name = await askText(t("worktree.prompt"), "ideia-1");
  if (!name) return;
  try {
    const path = await api.worktreeAdd(n.cwd || ws.root, name);
    newTerminal(n.profileId, { cwd: path, title: `${n.title} · ${name}`, x: n.x + 40, y: n.y + n.h + 30 });
    toast(t("worktree.done", { path }));
  } catch (e) {
    toast(t("worktree.error", { error: String(e) }));
  }
}

// ---------- workspaces ----------

let loadedId: string | null = null;

export async function refreshList() {
  setState({ list: await api.wsList() });
}

export async function openWorkspace(id: string) {
  const { text, recovered } = await api.wsLoad(id);
  const ws = migrate(JSON.parse(text));
  loadedId = ws.id;
  setState({ ws, selection: null, selEdge: null, stats: {}, states: {}, git: {}, memAlerts: {}, activity: [] });
  localStorage.setItem("regente.last", ws.id);
  if (recovered) toast(t("ws.recovered"));
  setUi({ tab: "agents" });
}

export async function createAndOpenWorkspace(name: string, root: string) {
  const ws = createWorkspace(name.trim() || "Workspace", root.trim());
  await api.wsSave(ws.id, JSON.stringify(ws));
  await refreshList();
  await openWorkspace(ws.id);
}

export async function deleteWorkspace(id: string) {
  await api.wsDelete(id);
  if (getState().ws?.id === id) setState({ ws: null });
  await refreshList();
}

export function exportWorkspace() {
  const ws = getState().ws;
  if (!ws) return;
  const blob = new Blob([JSON.stringify(ws, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(ws.name)}.regente.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function importWorkspaceFile(file: File) {
  const raw = JSON.parse(await file.text());
  const parsed = migrate(raw);
  // Arquivo de terceiros não é confiável: o usuário escolhe a pasta raiz e os poderes (coordenador, teclas, papéis,
  // rotinas) são removidos; todas as conexões passam a exigir confirmação humana.
  const root = (await askText(t("import.root"), parsed.root))?.trim();
  if (!root) return void toast(t("import.cancelled"));
  const ws = hardenImported(parsed, root);
  ws.id = uid("ws"); // nunca sobrescreve um workspace existente
  toast(t("import.hardened"));
  await api.wsSave(ws.id, JSON.stringify(ws));
  await refreshList();
  await openWorkspace(ws.id);
}

export async function pickDirectory(): Promise<string | null> {
  const r = await openDialog({ directory: true, multiple: false });
  return typeof r === "string" ? r : null;
}
export async function pickFile(): Promise<string | null> {
  const r = await openDialog({ directory: false, multiple: false });
  return typeof r === "string" ? r : null;
}

// ---------- configurações ----------

export async function saveSettings(s: Settings) {
  setState({ settings: s });
  applySettings(s);
  await api.configSave("settings", JSON.stringify(s));
}

export function applySettings(s: Settings) {
  setLang(s.lang);
  document.documentElement.dataset.theme = s.theme;
}

export async function saveProfiles(p: AgentProfile[]) {
  setState({ profiles: p });
  await api.configSave("profiles", JSON.stringify(p, null, 2));
}

export async function bootstrap() {
  const info = await api.appInfo();
  setState({ info });
  try {
    const s = await api.configLoad("settings");
    if (s) setState({ settings: { ...DEFAULT_SETTINGS, ...JSON.parse(s) } });
    const p = await api.configLoad("profiles");
    if (p) setState({ profiles: JSON.parse(p) });
  } catch {
    /* config corrompida: usa padrões */
  }
  applySettings(getState().settings);
  await refreshList();
  await loadTemplates();
  const last = localStorage.getItem("regente.last");
  if (last && getState().list.some((w) => w.id === last)) await openWorkspace(last).catch(() => {});

  on<LogEntry>("activity", (e) => setState((s) => ({ activity: [...s.activity.slice(-499), e] })));
  on<{ id: string; text: string }>("note-updated", (e) => {
    mutateWs((ws) => ({ ...ws, nodes: ws.nodes.map((n) => (n.id === e.id && n.kind === "note" ? { ...n, text: e.text } : n)) }));
  });
  on<{ id: string; name: string; status: import("./store").WorkInfo }>("work-status", (e) => setState((s) => ({ work: { ...s.work, [e.id]: e.status } })));
  on<{ id: string; name: string; text: string }>("agent-notify", (e) => {
    const msg = t("notify.agent", { name: e.name, text: e.text });
    toast(msg);
    void notify(msg);
  });
  on<CoordReq>("coord-request", (r) => void handleCoord(r));
  on<import("./store").ConfirmReq>("confirm-request", (c) => setState({ confirm: c }));
  api.orchLog().then((l) => setState({ activity: l })).catch(() => {});

  startPolling();
}

// ---------- templates de equipe e papéis ----------

async function persistTemplates(list: import("./types").TeamTemplate[]) {
  setState({ templates: list });
  await api.configSave("templates", JSON.stringify(list, null, 2)).catch(() => {});
}

export async function loadTemplates() {
  try {
    const raw = await api.configLoad("templates");
    if (raw) setState({ templates: sanitizeTemplates(JSON.parse(raw)) });
  } catch {
    /* arquivo corrompido: começa vazio */
  }
}

/** Salva como template todos os terminais e notas do workspace, com conexões e papéis. */
export async function saveCurrentAsTemplate(name: string) {
  const { ws, templates } = getState();
  if (!ws) return;
  const tpl = captureTemplate(ws, name);
  if (!tpl) return void toast(t("tpl.nothing"));
  await persistTemplates([...templates, tpl].slice(-50));
  toast(t("tpl.saved", { name: tpl.name }));
}

export async function deleteTemplate(id: string) {
  await persistTemplates(getState().templates.filter((x) => x.id !== id));
}

/** Envia a instrução inicial ao agente (colagem entre colchetes + Enter), só para perfis de agente. */
function sendRolePrompt(id: string, text: string) {
  const clean = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  void api.write(id, `\u001b[200~${clean}\u001b[201~`).then(() => setTimeout(() => void api.write(id, "\r").catch(() => {}), 200)).catch(() => {});
}

/** Insere o template num espaço livre do canvas; agentes com papel recebem a instrução depois de iniciar. */
export async function insertTemplate(id: string) {
  const { ws, templates, profiles } = getState();
  const tpl = templates.find((x) => x.id === id);
  if (!ws || !tpl) return;
  const c = viewCenterWorld();
  const size = templateSize(tpl);
  const spot = placeNear(ws.nodes, size.w, size.h, c.x, c.y);
  const made = instantiateTemplate(tpl, spot, ws.root, maxZ(ws), ws.nodes.map((n) => n.title));
  mutateWs((w) => ({ ...w, nodes: [...w.nodes, ...made.nodes], edges: [...w.edges, ...made.edges] }));
  setState({ selection: made.nodes[0]?.id ?? null });
  setUi({ templates: false });
  for (const p of made.prompts) {
    const prof = profiles.find((x) => x.id === p.profileId);
    if (prof?.command && prof.paste) setTimeout(() => sendRolePrompt(p.id, p.text), 6000);
  }
  toast(t("tpl.inserted", { name: tpl.name }));
}

/** Define o papel (instrução inicial) de um terminal e, se for um agente, já o envia. */
export async function setRolePrompt(id: string) {
  const ws = getState().ws;
  const n = ws?.nodes.find((x): x is TerminalNode => x.id === id && x.kind === "terminal");
  if (!n) return;
  const text = await askText(t("role.prompt"), n.rolePrompt ?? "");
  if (text === null) return;
  updateNode(id, { rolePrompt: text.trim() || undefined } as Partial<AnyNode>);
  const prof = getState().profiles.find((x) => x.id === n.profileId);
  if (text.trim() && prof?.command && prof.paste) sendRolePrompt(id, text.trim());
}

// ---------- rotinas agendadas ----------

const firing = new Set<string>();

export function addRoutine(r: Omit<Routine, "id" | "runs" | "createdAt">) {
  mutateWs((ws) => ({ ...ws, routines: [...ws.routines, { ...r, id: uid("r"), runs: 0, createdAt: Date.now() }] }));
}
export function updateRoutine(id: string, patch: Partial<Routine>) {
  mutateWs((ws) => ({ ...ws, routines: ws.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
}
export function removeRoutine(id: string) {
  mutateWs((ws) => ({ ...ws, routines: ws.routines.filter((r) => r.id !== id) }));
}

/** Dispara uma rotina (agendada ou manual). Pausa global adia sem consumir a execução. */
export async function fireRoutine(id: string) {
  const ws = getState().ws;
  const r = ws?.routines.find((x) => x.id === id);
  const node = ws?.nodes.find((n): n is TerminalNode => n.id === r?.termId && n.kind === "terminal");
  if (!ws || !r || firing.has(id)) return;
  if (!node) return void updateRoutine(id, { enabled: false });
  firing.add(id);
  try {
    const res = await api.routineFire(node.id, r.title, r.text, r.preRun ?? null, node.cwd || ws.root, r.reminder === true);
    if (res === "pausada") return;
    const done = res === "enviada" || res === "lembrete";
    updateRoutine(id, { lastRun: Date.now(), runs: done ? r.runs + 1 : r.runs, ...(r.kind === "once" ? { enabled: false } : {}) });
    if (!done) toast(t("routine.skipped", { title: r.title }));
  } catch (e) {
    updateRoutine(id, { lastRun: Date.now(), ...(r.kind === "once" ? { enabled: false } : {}) });
    toast(t("routine.error", { title: r.title, error: String(e) }));
  } finally {
    firing.delete(id);
  }
}

function tickRoutines() {
  const ws = getState().ws;
  if (!ws) return;
  const now = new Date();
  for (const r of ws.routines) if (isDue(r, now)) void fireRoutine(r.id);
}

// ---------- coordenador: recrutar, conectar e dispensar por CLI ----------

interface CoordReq {
  id: string;
  op: string;
  from: string;
  params: Record<string, unknown>;
  /** Epoch ms: a interface descarta pedidos vencidos (o broker já desistiu deles). */
  expiresAt?: number;
}

async function handleCoord(r: CoordReq) {
  const answer = (ok: boolean, result: unknown = null, error: string | null = null) => void api.coordAnswer(r.id, ok, result, error).catch(() => {});
  if (typeof r.expiresAt === "number" && Date.now() > r.expiresAt) return answer(false, null, "pedido expirado");
  if (getState().paused) return answer(false, null, "orquestração pausada pelo usuário");
  const ws = getState().ws;
  if (!ws) return answer(false, null, "nenhum workspace aberto");
  const me = ws.nodes.find((n): n is TerminalNode => n.id === r.from && n.kind === "terminal");
  if (!me) return answer(false, null, "coordenador não encontrado no canvas");
  if (!me.coordinator) return answer(false, null, "este terminal deixou de ser coordenador");
  const isTerm = (id: unknown) => ws.nodes.some((n) => n.id === id && n.kind === "terminal");
  const link = (a: string, b: string, bidirectional: boolean) =>
    mutateWs((w) =>
      w.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))
        ? w
        : { ...w, edges: [...w.edges, { id: uid("e"), from: a, to: b, bidirectional, confirm: false }] },
    );
  try {
    if (r.op === "recruit") {
      const wanted = String(r.params.profile ?? "").trim().toLowerCase();
      const { profiles } = getState();
      const p = profiles.find((x) => x.id.toLowerCase() === wanted) ?? profiles.find((x) => x.name.toLowerCase() === wanted);
      if (!wanted || !p) return answer(false, null, `perfil '${wanted}' não existe (use: ${profiles.map((x) => x.id).join(", ")})`);
      const cwd = String(r.params.cwd ?? "").trim() || me.cwd || ws.root;
      if (!isInside(cwd, ws.root) && !isInside(cwd, me.cwd || ws.root)) return answer(false, null, "a pasta precisa ficar dentro do workspace");
      const spot = placeNear(ws.nodes, 640, 400, me.x + me.w + 380, me.y + 200);
      const name = String(r.params.name ?? "").trim();
      const id = newTerminal(p.id, { cwd, x: spot.x, y: spot.y, ...(name ? { title: name } : {}) });
      if (!id) return answer(false, null, "não foi possível criar o terminal");
      link(me.id, id, true);
      const title = getState().ws?.nodes.find((n) => n.id === id)?.title ?? name;
      return answer(true, { id, name: title, profile: p.id });
    }
    if (r.op === "connect") {
      const a = String(r.params.a);
      const b = String(r.params.b);
      if (!isTerm(a) || !isTerm(b)) return answer(false, null, "agente não encontrado no canvas");
      link(a, b, r.params.bidirectional !== false);
      return answer(true);
    }
    if (r.op === "dismiss") {
      const id = String(r.params.id);
      if (!isTerm(id) || id === me.id) return answer(false, null, "agente não encontrado no canvas");
      removeNode(id);
      return answer(true);
    }
    return answer(false, null, `operação desconhecida: ${r.op}`);
  } catch (e) {
    return answer(false, null, String(e));
  }
}

// ---------- persistência contínua ----------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let ctxTimer: ReturnType<typeof setTimeout> | undefined;
let lastSavedWs: Workspace | null = null;
let lastSyncKey = "";
let lastStatesKey = "";

export function onStateChanged() {
  const { ws } = getState();
  if (!ws || ws.id !== loadedId || ws === lastSavedWs) return;
  lastSavedWs = ws;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.wsSave(ws.id, JSON.stringify(ws)).catch((e) => console.error("falha ao salvar", e));
  }, 800);
  clearTimeout(ctxTimer);
  ctxTimer = setTimeout(() => mirrorNotes(ws), 1500);
  syncOrchestrator(ws);
}

/** Espelha as notas em `<root>/.regente/notes/*.md` (contexto versionável). */
function mirrorNotes(ws: Workspace) {
  if (!ws.root) return;
  const seen = new Set<string>();
  for (const n of ws.nodes) {
    if (n.kind !== "note") continue;
    let name = slug(n.title);
    while (seen.has(name)) name += "-2";
    seen.add(name);
    api.writeContext(ws.root, `notes/${name}.md`, `# ${n.title}\n\n${n.text}\n`).catch(() => {});
  }
}

export function syncOrchestrator(ws: Workspace) {
  const { profiles } = getState();
  const terms = ws.nodes
    .filter((n): n is TerminalNode => n.kind === "terminal")
    .map((n) => {
      const p = profiles.find((x) => x.id === n.profileId);
      return { id: n.id, name: n.title, profile: p?.id ?? n.profileId, paste: p?.paste ?? false, coordinator: !!n.coordinator };
    });
  const notes = ws.nodes.filter((n) => n.kind === "note").map((n) => ({ id: n.id, title: n.title, text: n.kind === "note" ? n.text : "" }));
  const key = JSON.stringify([terms, notes, ws.edges]);
  if (key === lastSyncKey) return;
  lastSyncKey = key;
  api.orchSync(terms, notes, ws.edges).catch(() => {});
}

export async function setPaused(p: boolean) {
  setState({ paused: p });
  await api.orchPause(p);
}

// ---------- polling de estatísticas, estados, git e notificações ----------

const workingSince: Record<string, number> = {};
const memNotified: Record<string, boolean> = {};

async function notify(body: string) {
  if (!getState().settings.notifications || document.hasFocus()) return;
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (ok) sendNotification({ title: "Regente", body });
  } catch {
    /* notificações indisponíveis */
  }
}

async function pollStats() {
  const { ws, profiles, settings } = getState();
  if (!ws) return;
  let stats;
  try {
    stats = await api.stats();
  } catch {
    return;
  }
  const byId: Record<string, (typeof stats)[number]> = {};
  const states: Record<string, import("./types").AgentState> = {};
  const alerts: Record<string, boolean> = {};
  const prev = getState().states;
  for (const s of stats) {
    byId[s.id] = s;
    const node = ws.nodes.find((n) => n.id === s.id);
    if (!node || node.kind !== "terminal") continue;
    const profile = profiles.find((p) => p.id === node.profileId);
    const st = computeState(s, compilePatterns(profile));
    states[s.id] = st;
    const before = prev[s.id];
    if (st === "working" && before !== "working") workingSince[s.id] = Date.now();
    if (before === "working" && st !== "working" && Date.now() - (workingSince[s.id] ?? 0) > 4000 && profile?.command) {
      if (st === "waiting") void notify(t("notify.waiting", { name: node.title }));
      else if (st === "idle" || st === "exited") void notify(t("notify.done", { name: node.title }));
    }
    const mb = s.rssBytes / 1048576;
    alerts[s.id] = mb > settings.memAlertMb;
    if (alerts[s.id] && !memNotified[s.id]) {
      memNotified[s.id] = true;
      void notify(t("notify.mem", { name: node.title, mb: Math.round(mb) }));
      toast(t("notify.mem", { name: node.title, mb: Math.round(mb) }));
    }
    if (!alerts[s.id]) memNotified[s.id] = false;
  }
  setState({ stats: byId, states, memAlerts: alerts });
  const statesKey = JSON.stringify(states);
  if (statesKey !== lastStatesKey) {
    lastStatesKey = statesKey;
    api.orchSetStates(states).catch(() => {});
  }
}

async function pollGit() {
  const ws = getState().ws;
  if (!ws) return;
  const dirs = new Set(ws.nodes.filter((n): n is TerminalNode => n.kind === "terminal").map((n) => n.cwd || ws.root).filter(Boolean));
  const git: Record<string, { branch: string; dirty: boolean } | null> = {};
  await Promise.all([...dirs].map(async (d) => (git[d] = await api.gitInfo(d).catch(() => null))));
  setState({ git });
}

let polling = false;
function startPolling() {
  setInterval(tickRoutines, 20_000);
  if (polling) return;
  polling = true;
  setInterval(pollStats, 2000);
  setInterval(pollGit, 12000);
  setTimeout(pollGit, 1500);
}
