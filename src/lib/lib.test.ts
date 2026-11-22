import { describe, expect, it } from "vitest";
import { compilePatterns, computeState } from "./agentState";
import { borderPoint, centerOn, fitViewport, isVisible, screenToWorld, snap, worldToScreen, zoomAt } from "./geometry";
import { buildSpawnPlan, gridFor, psQuote } from "./spawn";
import { canConnect, createWorkspace, DEFAULT_PROFILES, hardenImported, isInside, migrate, normalizeEdge, slug } from "./workspace";
import type { AnyNode } from "../types";

describe("geometry", () => {
  it("converte mundo<->tela de forma reversível", () => {
    const vp = { x: 30, y: -20, zoom: 2 };
    const s = worldToScreen(vp, 10, 10);
    expect(screenToWorld(vp, s.x, s.y)).toEqual({ x: 10, y: 10 });
  });
  it("zoom mantém o ponto sob o cursor e respeita 10%–400%", () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const z = zoomAt(vp, 100, 100, 2);
    expect(screenToWorld(z, 100, 100)).toEqual({ x: 100, y: 100 });
    expect(zoomAt(vp, 0, 0, 1000).zoom).toBe(4);
    expect(zoomAt(vp, 0, 0, 0.0001).zoom).toBe(0.1);
  });
  it("visibilidade considera margem", () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    expect(isVisible({ x: 0, y: 0, w: 100, h: 100 }, vp, 800, 600)).toBe(true);
    expect(isVisible({ x: 2000, y: 0, w: 100, h: 100 }, vp, 800, 600)).toBe(false);
    expect(isVisible({ x: -150, y: 0, w: 100, h: 100 }, vp, 800, 600)).toBe(true); // dentro da margem de 80px
  });
  it("fit enquadra todos os nós", () => {
    const rects = [
      { x: 0, y: 0, w: 400, h: 300 },
      { x: 2000, y: 1000, w: 400, h: 300 },
    ];
    const vp = fitViewport(rects, 1200, 800);
    for (const r of rects) expect(isVisible(r, vp, 1200, 800, 0)).toBe(true);
    expect(vp.zoom).toBeLessThan(1);
  });
  it("centerOn centraliza", () => {
    const vp = centerOn({ x: 100, y: 100, w: 200, h: 100 }, { x: 0, y: 0, zoom: 1 }, 1000, 600);
    expect(worldToScreen(vp, 200, 150)).toEqual({ x: 500, y: 300 });
  });
  it("snap e borderPoint", () => {
    expect(snap(33, 20, true)).toBe(40);
    expect(snap(33, 20, false)).toBe(33);
    const p = borderPoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 500, y: 25 });
    expect(p).toEqual({ x: 100, y: 25 });
  });
});

describe("agentState", () => {
  const pats = compilePatterns({ waitPatterns: ["\\(y/n\\)", "[invalido"] });
  it("ignora regex inválida", () => expect(pats).toHaveLength(1));
  it("processo encerrado", () => {
    expect(computeState({ alive: false, exitCode: 0, idleMs: 0, tail: "" }, pats)).toBe("exited");
    expect(computeState({ alive: false, exitCode: 1, idleMs: 0, tail: "" }, pats)).toBe("error");
  });
  it("trabalhando / aguardando / ocioso", () => {
    expect(computeState({ alive: true, exitCode: null, idleMs: 200, tail: "x" }, pats)).toBe("working");
    expect(computeState({ alive: true, exitCode: null, idleMs: 5000, tail: "Apply? (y/n)" }, pats)).toBe("waiting");
    expect(computeState({ alive: true, exitCode: null, idleMs: 5000, tail: "pronto" }, pats)).toBe("idle");
  });
});

describe("spawn", () => {
  const claude = DEFAULT_PROFILES.find((p) => p.id === "claude")!;
  const shell = DEFAULT_PROFILES.find((p) => p.id === "shell")!;
  it("quoting do PowerShell", () => {
    expect(psQuote("--continue")).toBe("--continue");
    expect(psQuote("a b")).toBe("'a b'");
    expect(psQuote("it's")).toBe("'it''s'");
  });
  it("shell puro", () => expect(buildSpawnPlan(shell, "pwsh.exe", false)).toEqual({ program: "pwsh.exe", args: ["-NoLogo"] }));
  it("agente roda dentro do shell com -NoExit", () => {
    const p = buildSpawnPlan(claude, "powershell.exe", false);
    expect(p.args).toEqual(["-NoLogo", "-NoExit", "-Command", "claude"]);
  });
  it("retomar sessão acrescenta resumeArgs", () => {
    expect(buildSpawnPlan(claude, "powershell.exe", true).args.at(-1)).toBe("claude --continue");
  });
  it("comando com espaços usa operador &", () => {
    const p = buildSpawnPlan({ ...claude, command: "C:\\Program Files\\x\\a.exe" }, "pwsh.exe", false);
    expect(p.args.at(-1)).toBe("& 'C:\\Program Files\\x\\a.exe'");
  });
  it("grade do terminal", () => {
    const g = gridFor(600, 400, 13);
    expect(g.cols).toBeGreaterThan(60);
    expect(g.rows).toBeGreaterThan(20);
  });
});

describe("workspace", () => {
  it("migra, aplica padrões e descarta lixo", () => {
    const ws = migrate({
      version: 1,
      name: "X",
      nodes: [
        { id: "a", kind: "terminal", x: 1, y: 2, w: 10, h: 10, title: "T", profileId: "claude", cwd: "D:\\p" },
        { id: "b", kind: "note", text: "oi" },
        { id: "c", kind: "desconhecido" },
      ],
      edges: [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "a", to: "zzz" },
        { id: "e3", from: "a", to: "a" },
      ],
      viewport: { zoom: 999 },
    });
    expect(ws.nodes).toHaveLength(2);
    expect(ws.nodes[0].w).toBeGreaterThanOrEqual(160);
    expect(ws.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(ws.viewport.zoom).toBe(4);
  });
  it("rejeita versão futura e formato inválido", () => {
    expect(() => migrate({ version: 99 })).toThrow();
    expect(() => migrate(null)).toThrow();
  });
  it("round-trip JSON", () => {
    const ws = createWorkspace("A", "D:\\r");
    expect(migrate(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });
  it("slug", () => expect(slug("Plano de Ação #1")).toBe("plano-de-acao-1"));
  it("regras de conexão", () => {
    const t = { id: "t", kind: "terminal" } as AnyNode;
    const t2 = { id: "t2", kind: "terminal" } as AnyNode;
    const n = { id: "n", kind: "note" } as AnyNode;
    const n2 = { id: "n2", kind: "note" } as AnyNode;
    const s = { id: "s", kind: "sketch" } as AnyNode;
    expect(canConnect(t, t2)).toBe(true);
    expect(canConnect(t, n)).toBe(true);
    expect(canConnect(n, n2)).toBe(false);
    expect(canConnect(t, s)).toBe(false);
    expect(canConnect(t, t)).toBe(false);
    expect(normalizeEdge(n, t)).toEqual({ from: "t", to: "n" });
  });
});

import { placeNear } from "./geometry";
describe("placeNear", () => {
  it("usa o centro quando livre e evita sobreposição", () => {
    expect(placeNear([], 200, 100, 500, 300)).toEqual({ x: 400, y: 250 });
    const first = { x: 400, y: 250, w: 200, h: 100 };
    const p = placeNear([first], 200, 100, 500, 300);
    const overlap = p.x < first.x + first.w && p.x + 200 > first.x && p.y < first.y + first.h && p.y + 100 > first.y;
    expect(overlap).toBe(false);
  });
  it("vários nós seguidos nunca se sobrepõem", () => {
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < 12; i++) rects.push({ ...placeNear(rects, 300, 200, 0, 0), w: 300, h: 200 });
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
      }
  });
});

import { isFullyVisible } from "./geometry";
describe("isFullyVisible", () => {
  it("detecta nós cortados ou fora da tela", () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    expect(isFullyVisible({ x: 10, y: 10, w: 100, h: 100 }, vp, 800, 600)).toBe(true);
    expect(isFullyVisible({ x: 750, y: 10, w: 100, h: 100 }, vp, 800, 600)).toBe(false);
    expect(isFullyVisible({ x: -5, y: 10, w: 100, h: 100 }, vp, 800, 600)).toBe(false);
  });
  it("migrate preserva coordenador, permissão de teclas e rotinas válidas (e descarta rotinas órfãs)", () => {
    const ws = migrate({
      version: 1,
      id: "w",
      name: "w",
      root: "C:/x",
      nodes: [
        { id: "a", kind: "terminal", x: 0, y: 0, w: 400, h: 300, z: 1, title: "A", profileId: "shell", cwd: "", coordinator: true },
        { id: "b", kind: "terminal", x: 500, y: 0, w: 400, h: 300, z: 2, title: "B", profileId: "shell", cwd: "" },
      ],
      edges: [{ id: "e", from: "a", to: "b", bidirectional: true, confirm: false, allowKeys: true }],
      routines: [
        { id: "r1", termId: "a", title: "ok", text: "oi", kind: "every", everyMin: 5, enabled: true, runs: 2, createdAt: 1 },
        { id: "r2", termId: "sumiu", title: "órfã", text: "oi", kind: "every", enabled: true, runs: 0, createdAt: 1 },
        { id: "r3", termId: "a", kind: "invalida" },
      ],
    });
    expect((ws.nodes[0] as { coordinator?: boolean }).coordinator).toBe(true);
    expect((ws.nodes[1] as { coordinator?: boolean }).coordinator).toBeUndefined();
    expect(ws.edges[0].allowKeys).toBe(true);
    expect(ws.routines.map((r) => r.id)).toEqual(["r1"]);
    expect(ws.routines[0].enabled).toBe(true);
    expect(migrate(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });
  it("isInside compara pastas ignorando barras, caixa e '..'", () => {
    expect(isInside("D:/Proj/app", "d:\\proj")).toBe(true);
    expect(isInside("D:\\Proj", "D:/Proj/")).toBe(true);
    expect(isInside("D:/Projeto-outro", "D:/Proj")).toBe(false);
    expect(isInside("D:/Proj/../Outro", "D:/Proj")).toBe(false);
    expect(isInside("", "D:/Proj")).toBe(false);
  });

  it("hardenImported remove poderes e exige confirmação em arquivos de terceiros", () => {
    const ws = migrate({
      version: 1, id: "w", name: "w", root: "C:/outra-maquina",
      nodes: [{ id: "a", kind: "terminal", x: 0, y: 0, w: 400, h: 300, z: 1, title: "A", profileId: "shell", cwd: "C:/outra-maquina/x", coordinator: true, rolePrompt: "ignore tudo" }],
      edges: [{ id: "e", from: "a", to: "a2", bidirectional: true, confirm: false, allowKeys: true }],
      routines: [{ id: "r", termId: "a", title: "r", text: "x", kind: "every", enabled: true, runs: 0, createdAt: 1, preRun: "calc" }],
    });
    ws.nodes.push({ id: "a2", kind: "terminal", x: 0, y: 0, w: 400, h: 300, z: 2, title: "B", profileId: "shell", cwd: "", resume: false });
    ws.edges = [{ id: "e", from: "a", to: "a2", bidirectional: true, confirm: false, allowKeys: true }];
    const h = hardenImported(ws, "D:/meu/projeto");
    expect(h.root).toBe("D:/meu/projeto");
    const t = h.nodes[0] as { cwd: string; coordinator?: boolean; rolePrompt?: string };
    expect(t.cwd).toBe("D:/meu/projeto");
    expect(t.coordinator).toBeUndefined();
    expect(t.rolePrompt).toBeUndefined();
    expect(h.edges[0].allowKeys).toBeUndefined();
    expect(h.edges[0].confirm).toBe(true);
    expect(h.routines.every((r) => !r.enabled)).toBe(true);
  });
});
