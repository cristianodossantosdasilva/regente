import { describe, expect, it } from "vitest";
import { captureTemplate, instantiateTemplate, sanitizeTemplates, templateSize } from "./templates";
import { createWorkspace } from "./workspace";
import type { NoteNode, TerminalNode, Workspace } from "../types";

function sample(): Workspace {
  const ws = createWorkspace("w", "C:/proj");
  const term = (id: string, title: string, x: number, y: number, extra: Partial<TerminalNode> = {}): TerminalNode => ({ id, kind: "terminal", x, y, w: 600, h: 400, z: 1, title, profileId: "claude", cwd: "C:/proj", resume: false, ...extra });
  const note: NoteNode = { id: "n", kind: "note", x: 100, y: 500, w: 300, h: 200, z: 1, title: "Plano", text: "# plano" };
  ws.nodes = [term("a", "Claude", 100, 100, { coordinator: true, rolePrompt: "Você coordena." }), term("b", "Kiro", 800, 100), note, { id: "s", kind: "sketch", x: 0, y: 0, w: 200, h: 200, z: 1, title: "Esboço", shapes: [] }];
  ws.edges = [
    { id: "e1", from: "a", to: "b", bidirectional: true, confirm: false, allowKeys: true },
    { id: "e2", from: "a", to: "n", bidirectional: false, confirm: true },
    { id: "e3", from: "a", to: "s", bidirectional: false, confirm: false },
  ];
  return ws;
}

describe("templates de equipe", () => {
  it("captura só terminais e notas, com posições relativas e arestas entre eles", () => {
    const tpl = captureTemplate(sample(), "  Dev + Revisão  ")!;
    expect(tpl.name).toBe("Dev + Revisão");
    expect(tpl.nodes.map((n) => n.kind)).toEqual(["terminal", "terminal", "note"]);
    expect(tpl.nodes[0]).toMatchObject({ dx: 0, dy: 0, coordinator: true, prompt: "Você coordena." });
    expect(tpl.nodes[1]).toMatchObject({ dx: 700, dy: 0 });
    expect(tpl.edges).toHaveLength(2); // a→sketch fica de fora
    expect(tpl.edges[0]).toMatchObject({ from: 0, to: 1, bidirectional: true, allowKeys: true });
    expect(templateSize(tpl)).toEqual({ w: 1300, h: 600 });
    expect(captureTemplate(createWorkspace("v", "x"), "vazio")).toBeNull();
  });

  it("instancia com ids novos, títulos únicos, conexões remapeadas e instruções iniciais", () => {
    const tpl = captureTemplate(sample(), "Time")!;
    const r = instantiateTemplate(tpl, { x: 1000, y: 2000 }, "D:/novo", 10, ["Claude", "plano"]);
    expect(r.nodes.map((n) => n.title)).toEqual(["Claude 2", "Kiro", "Plano 2"]);
    expect(r.nodes[0]).toMatchObject({ x: 1000, y: 2000, cwd: "D:/novo", coordinator: true, z: 11 });
    expect(new Set(r.nodes.map((n) => n.id)).size).toBe(3);
    expect(r.edges[0]).toMatchObject({ from: r.nodes[0].id, to: r.nodes[1].id, bidirectional: true, allowKeys: true });
    expect(r.edges[1].confirm).toBe(true);
    expect(r.prompts).toEqual([{ id: r.nodes[0].id, text: "Você coordena.", profileId: "claude" }]);
  });

  it("sanitizeTemplates descarta lixo e corrige arestas inválidas", () => {
    expect(sanitizeTemplates(null)).toEqual([]);
    const out = sanitizeTemplates([
      { id: "t1", name: "ok", nodes: [{ kind: "terminal", title: "A", dx: 0, dy: 0, w: 10, h: 10, profileId: "kiro" }, { kind: "note", title: "N", text: "x" }, { kind: "browser" }], edges: [{ from: 0, to: 1 }, { from: 0, to: 9 }, { from: 1, to: 1 }] },
      { id: "t2", name: "sem nós", nodes: [] },
      "lixo",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].nodes).toHaveLength(2);
    expect(out[0].nodes[0]).toMatchObject({ w: 160, h: 100 });
    expect(out[0].edges).toEqual([{ from: 0, to: 1, bidirectional: false, confirm: false }]);
  });
});
