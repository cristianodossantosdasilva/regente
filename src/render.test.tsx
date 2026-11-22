// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Sem Tauri: o IPC é simulado; o objetivo é garantir que a árvore de componentes renderiza todos os tipos de nó.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification: vi.fn(), isPermissionGranted: vi.fn(), requestPermission: vi.fn() }));

describe("renderização da UI", () => {
  it("renderiza workspace com todos os tipos de nó, zona e conexão", async () => {
    const { App } = await import("./App");
    const { setState } = await import("./store");
    const { createWorkspace } = await import("./lib/workspace");
    const ws = createWorkspace("Teste", "D:\\x");
    ws.nodes = [
      { id: "t1", kind: "terminal", x: 0, y: 0, w: 600, h: 380, z: 1, title: "Claude Code", profileId: "claude", cwd: "D:\\x", resume: false },
      { id: "t2", kind: "terminal", x: 700, y: 0, w: 600, h: 380, z: 2, title: "Kiro CLI", profileId: "kiro", cwd: "D:\\x", resume: false },
      { id: "n1", kind: "note", x: 0, y: 450, w: 380, h: 300, z: 3, title: "Plano", text: "# Oi" },
      { id: "s1", kind: "sketch", x: 450, y: 450, w: 400, h: 300, z: 4, title: "Esboço", shapes: [{ t: "rect", x: 10, y: 10, w: 50, h: 30, c: "#fff" }] },
      { id: "d1", kind: "diagram", x: 900, y: 450, w: 400, h: 300, z: 5, title: "Diagrama", boxes: [{ id: "b", x: 10, y: 10, w: 100, h: 40, text: "A" }], links: [] },
      { id: "f1", kind: "file", x: 0, y: 800, w: 400, h: 300, z: 6, title: "Arquivo", path: "" },
      { id: "w1", kind: "browser", x: 450, y: 800, w: 400, h: 300, z: 7, title: "Navegador", url: "http://localhost:3000" },
    ];
    ws.zones = [{ id: "z1", x: -50, y: -50, w: 1400, h: 500, color: "#7c9cff", title: "Zona A" }];
    ws.edges = [{ id: "e1", from: "t1", to: "t2", bidirectional: true, confirm: true }];
    setState({ ws });
    const html = renderToString(<App />);
    for (const label of ["Claude Code", "Kiro CLI", "Plano", "Esboço", "Diagrama", "Arquivo", "Navegador", "Zona A"]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain("<iframe");
    expect(html).toContain("marker-end");
    expect(html).toContain("minimap");
  });

  it("mostra a tela de boas-vindas sem workspace", async () => {
    const { App } = await import("./App");
    const { setState } = await import("./store");
    setState({ ws: null });
    expect(renderToString(<App />)).toContain("Bem-vindo ao Regente");
  });
});
