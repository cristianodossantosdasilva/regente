import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useEffect, useRef } from "react";
import { createWorktreeFor, updateNode } from "../../actions";
import { api, PtyChunk, subscribePty } from "../../lib/ipc";
import { buildSpawnPlan, gridFor } from "../../lib/spawn";
import { t } from "../../lib/i18n";
import { getState, setState, useStore } from "../../store";
import type { AgentProfile, AgentState, TerminalNode as TNode } from "../../types";
import { HDR, NodeFrame } from "../NodeFrame";

/** Abaixo deste zoom o terminal vira um resumo em texto (sem xterm): economiza CPU e memória. */
const LOD_ZOOM = 0.3;

const THEMES = {
  dark: { background: "#0f1117", foreground: "#d7dae0", cursor: "#ffb454", selectionBackground: "#3b4a7a" },
  light: { background: "#fbfbfd", foreground: "#1d2330", cursor: "#c96a00", selectionBackground: "#bcd0ff" },
};

/** Cria o PTY quando o nó nasce e o encerra quando o nó é removido. Independe de o xterm estar montado. */
function useTerminalProcess(node: TNode, profile: AgentProfile) {
  const tick = useStore((s) => s.restartTick[node.id] ?? 0);
  const settings = useStore((s) => s.settings);
  const latest = useRef({ node, profile, settings });
  latest.current = { node, profile, settings };

  useEffect(() => {
    const { node: n, profile: p, settings: st } = latest.current;
    const { info, ws } = getState();
    const plan = buildSpawnPlan(p, info?.defaultShell ?? "powershell.exe", n.resume);
    const g = gridFor(n.w, n.h - HDR, st.fontSize);
    let dead = false;
    (async () => {
      await api.kill(n.id).catch(() => {});
      if (dead) return;
      api
        .spawn({
          id: n.id,
          program: plan.program,
          args: plan.args,
          cwd: n.cwd || ws?.root || undefined,
          env: p.env,
          cols: g.cols,
          rows: g.rows,
          scrollbackBytes: Math.min(8_000_000, Math.max(262_144, st.scrollbackLines * 200)),
        })
        .catch((e) => console.error("falha ao iniciar terminal", e));
    })();
    return () => {
      dead = true;
      api.kill(n.id).catch(() => {});
    };
    // O processo só é recriado ao reiniciar (tick) ou quando o nó é recriado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, tick]);

  // Redimensiona o PTY conforme a geometria do nó (independe do zoom).
  useEffect(() => {
    const g = gridFor(node.w, node.h - HDR, settings.fontSize);
    const h = setTimeout(() => api.resize(node.id, g.cols, g.rows).catch(() => {}), 150);
    return () => clearTimeout(h);
  }, [node.id, node.w, node.h, settings.fontSize]);
}

function XtermBody({ node, zoom, live }: { node: TNode; zoom: number; live: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    if (!live || !host.current) return;
    let cancelled = false;
    const st = getState().settings;
    const term = new Terminal({
      fontFamily: st.fontFamily,
      fontSize: Math.max(4, st.fontSize * zoom),
      lineHeight: 1.2,
      scrollback: st.scrollbackLines,
      cursorBlink: true,
      theme: THEMES[st.theme],
      windowsPty: { backend: "conpty" },
      allowProposedApi: false,
    });
    termRef.current = term;
    term.loadAddon(new FitAddon()); // reservado: o tamanho é calculado pela grade do mundo
    term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri).catch(() => {})));
    term.open(host.current);
    const g = gridFor(node.w, node.h - HDR, st.fontSize);
    term.resize(g.cols, g.rows);

    // Ctrl+C copia quando há seleção; Ctrl+V cola (com bracketed paste via term.paste).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === "c" || e.key === "C") && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (ctrl && (e.key === "v" || e.key === "V")) {
        void navigator.clipboard.readText().then((tx) => term.paste(tx));
        return false;
      }
      return true;
    });
    let lastReset = 0;
    const dataSub = term.onData((d) => {
      api.write(node.id, d).catch(() => {});
      // teclado = ação humana: encerra a cadeia anti-loop deste terminal (no máx. 1x/s)
      const now = Date.now();
      if (now - lastReset > 1000) {
        lastReset = now;
        api.orchResetDepth(node.id).catch(() => {});
      }
    });

    // Replay sem perdas: ouvimos primeiro, buscamos o buffer e descartamos o que já veio nele.
    let ready = false;
    const pending: PtyChunk[] = [];
    const off = subscribePty(node.id, (c) => (ready ? term.write(c.data) : pending.push(c)));
    (async () => {
      try {
        await api.setStreaming(node.id, true);
        const r = await api.replay(node.id);
        if (cancelled) return;
        if (r.data) term.write(r.data);
        for (const c of pending) if (c.start >= r.end) term.write(c.data);
        pending.length = 0;
        ready = true;
      } catch {
        ready = true; // PTY ainda não existe (será criado); a saída chegará por eventos
      }
    })();

    return () => {
      cancelled = true;
      off();
      dataSub.dispose();
      api.setStreaming(node.id, false).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, node.id]);

  // Fonte acompanha o zoom (com debounce, pois reconfigurar o renderer é caro).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const h = setTimeout(() => {
      term.options.fontSize = Math.max(4, settings.fontSize * zoom);
      term.options.fontFamily = settings.fontFamily;
      term.options.theme = THEMES[settings.theme];
      const g = gridFor(node.w, node.h - HDR, settings.fontSize);
      if (term.cols !== g.cols || term.rows !== g.rows) term.resize(g.cols, g.rows);
    }, 120);
    return () => clearTimeout(h);
  }, [zoom, settings.fontSize, settings.fontFamily, settings.theme, node.w, node.h, live]);

  return <div className="xterm-host" ref={host} onPointerDown={() => termRef.current?.focus()} />;
}

function TerminalViewInner({
  node,
  profile,
  state,
  visible,
  zoom,
  ...frame
}: {
  node: TNode;
  profile: AgentProfile;
  profiles: AgentProfile[];
  state?: AgentState;
  visible: boolean;
  zoom: number;
  vx: number;
  vy: number;
  selected: boolean;
  snapOn: boolean;
  grid: number;
  onConnectStart: (id: string, e: React.PointerEvent) => void;
}) {
  useTerminalProcess(node, profile);
  const stat = useStore((s) => s.stats[node.id]);
  const alert = useStore((s) => s.memAlerts[node.id]);
  const work = useStore((s) => s.work[node.id]);
  const git = useStore((s) => s.git[node.cwd || s.ws?.root || ""]);
  const live = visible && zoom >= LOD_ZOOM;
  const st = state ?? "idle";
  const mb = stat ? Math.round(stat.rssBytes / 1048576) : 0;

  const extra = (
    <>
      {git && (
        <span className="chip" title="git">
          ⎇ {git.branch}
          {git.dirty ? "*" : ""}
        </span>
      )}
      <span className={`chip st-${st}`} title={t(`agent.state.${st}`)}>{t(`agent.state.${st}`)}</span>
      {node.coordinator && (
        <span className="chip" title={t("coord.hint")}>
          👑
        </span>
      )}
      {work && (
        <span className={`chip work-${work.state}`} title={work.text}>
          {t(`work.${work.state}`)}
          {work.progress ? ` ${work.progress}` : ""}
        </span>
      )}
      {stat && (
        <span className={`chip mono ${alert ? "warn" : ""}`} title={alert ? t("agent.memAlert") : "CPU / RAM"}>
          {stat.cpu.toFixed(0)}% · {mb}MB
        </span>
      )}
      <button className={`icon ${node.resume ? "on" : ""}`} title={t("node.resume")} onClick={() => updateNode(node.id, { resume: !node.resume })}>
        ↺
      </button>
      <button className="icon" title={t("node.worktree")} onClick={() => void createWorktreeFor(node.id)}>
        ⎇
      </button>
      <button className="icon" title={t("node.restart")} onClick={() => setState((s) => ({ restartTick: { ...s.restartTick, [node.id]: (s.restartTick[node.id] ?? 0) + 1 } }))}>
        ⟳
      </button>
    </>
  );

  return (
    <NodeFrame
      {...frame}
      node={node}
      zoom={zoom}
      accent={profile.color}
      headerExtra={extra}
      connectable
      raw={() => (
        <div className="term-wrap">
          {live ? (
            <XtermBody node={node} zoom={zoom} live={live} />
          ) : (
            <pre className="lod" style={{ fontSize: Math.max(7, 12 * zoom * 2) }}>
              <span className="lod-tag">{t("terminal.dormant")}</span>
              {"\n"}
              {stat?.tail.split("\n").slice(-14).join("\n")}
            </pre>
          )}
          {stat && !stat.alive && (
            <div className="term-exit">
              {t("terminal.exited", { code: stat.exitCode ?? 0 })}
              <button onClick={() => setState((s) => ({ restartTick: { ...s.restartTick, [node.id]: (s.restartTick[node.id] ?? 0) + 1 } }))}>{t("node.restart")}</button>
            </div>
          )}
        </div>
      )}
    />
  );
}

export const TerminalView = memo(TerminalViewInner);
