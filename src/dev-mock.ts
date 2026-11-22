// Somente desenvolvimento: permite abrir a UI num navegador comum (sem o shell Tauri) para inspeção visual.
// Não entra no build de produção (importado dinamicamente atrás de import.meta.env.DEV).
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";

const store = new Map<string, string>();

export function installMock() {
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "app_info":
          return { dataDir: "C:/mock", cliDir: null, pipe: "mock", version: "dev", cliAvailable: true, defaultShell: "pwsh.exe", home: "C:/Users/dev" };
        case "config_load":
          return null;
        case "ws_list":
          return [...store.keys()].filter((k) => k.startsWith("ws:")).map((k) => {
            const j = JSON.parse(store.get(k)!);
            return { id: j.id, name: j.name, root: j.root, updatedMs: Date.now() };
          });
        case "ws_save":
          store.set(`ws:${a.id}`, String(a.text));
          return null;
        case "ws_load":
          return { text: store.get(`ws:${a.id}`), recovered: false };
        case "pty_spawn": {
          const id = String(a.spec && (a.spec as { id: string }).id);
          setTimeout(() => void emit("pty-output", { id, start: 0, data: "\x1b[32mPS C:\\projeto>\x1b[0m terminal simulado (mock de desenvolvimento)\r\n" }), 300);
          return { pid: 1 };
        }
        case "pty_replay":
          return { data: "\x1b[32mPS C:\\projeto>\x1b[0m terminal simulado (mock)\r\n", end: 0, exitCode: null };
        case "pty_stats":
          return [];
        case "orch_log":
          return [];
        case "git_info":
          return { branch: "main", dirty: true };
        case "detect_commands":
          return Object.fromEntries(((a.names as string[]) ?? []).map((n) => [n, n === "claude" ? "C:/bin/claude.exe" : null]));
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
