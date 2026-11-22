import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addEdge, fitAll, mutateWs, removeEdge, removeNode, setViewport, updateEdge } from "../actions";
import { borderPoint, center, contains, zoomAt } from "../lib/geometry";
import { isVisible, snap } from "../lib/geometry";
import { t } from "../lib/i18n";
import { askText, setState, useStore } from "../store";
import type { AnyNode, TerminalNode, Zone } from "../types";
import { profileOf } from "../actions";
import { dragWith, isTypingTarget } from "./drag";
import { NodeFrame } from "./NodeFrame";
import { Minimap } from "./Minimap";
import { TerminalView } from "./nodes/TerminalNode";
import { NoteView } from "./nodes/NoteNode";
import { SketchView } from "./nodes/SketchNode";
import { DiagramView } from "./nodes/DiagramNode";
import { FileView } from "./nodes/FileNode";
import { BrowserView } from "./nodes/BrowserNode";

function ZoneView({ zone, zoom, vx, vy, snapOn, grid, nodes }: { zone: Zone; zoom: number; vx: number; vy: number; snapOn: boolean; grid: number; nodes: AnyNode[] }) {
  const move = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    // Arrastar a zona leva junto os nós cujo centro está dentro dela.
    const inside = nodes.filter((n) => contains(zone, n)).map((n) => ({ id: n.id, x: n.x, y: n.y }));
    const { x, y } = zone;
    dragWith(e, (dx, dy) => {
      const ddx = snap(x + dx / zoom, grid, snapOn) - x;
      const ddy = snap(y + dy / zoom, grid, snapOn) - y;
      mutateWs((ws) => ({
        ...ws,
        zones: ws.zones.map((z) => (z.id === zone.id ? { ...z, x: x + ddx, y: y + ddy } : z)),
        nodes: ws.nodes.map((n) => {
          const o = inside.find((i) => i.id === n.id);
          return o ? { ...n, x: o.x + ddx, y: o.y + ddy } : n;
        }),
      }));
    });
  };
  const resize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const { w, h } = zone;
    dragWith(e, (dx, dy) =>
      mutateWs((ws) => ({ ...ws, zones: ws.zones.map((z) => (z.id === zone.id ? { ...z, w: Math.max(120, w + dx / zoom), h: Math.max(80, h + dy / zoom) } : z)) })),
    );
  };
  const rename = async () => {
    const v = await askText(t("node.rename"), zone.title);
    if (v) mutateWs((ws) => ({ ...ws, zones: ws.zones.map((z) => (z.id === zone.id ? { ...z, title: v } : z)) }));
  };
  return (
    <div className="zone" style={{ left: zone.x * zoom + vx, top: zone.y * zoom + vy, width: zone.w * zoom, height: zone.h * zoom, ["--zc" as string]: zone.color }}>
      <div className="zone-hdr" style={{ transform: `scale(${zoom})`, width: zone.w }} onPointerDown={move} onDoubleClick={rename}>
        <span>{zone.title}</span>
        <input type="color" value={zone.color} onChange={(e) => mutateWs((ws) => ({ ...ws, zones: ws.zones.map((z) => (z.id === zone.id ? { ...z, color: e.target.value } : z)) }))} />
        <button className="icon" onClick={() => mutateWs((ws) => ({ ...ws, zones: ws.zones.filter((z) => z.id !== zone.id) }))}>
          ×
        </button>
      </div>
      <div className="resize" onPointerDown={resize} />
    </div>
  );
}

export function Canvas() {
  const ws = useStore((s) => s.ws)!;
  const settings = useStore((s) => s.settings);
  const selection = useStore((s) => s.selection);
  const selEdge = useStore((s) => s.selEdge);
  const states = useStore((s) => s.states);
  const activity = useStore((s) => s.activity);
  const profiles = useStore((s) => s.profiles);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [connecting, setConnecting] = useState<{ from: string; x: number; y: number } | null>(null);
  const space = useRef(false);
  const vp = ws.viewport;
  const vpRef = useRef(vp);
  vpRef.current = vp;

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
      setState({ size: { w: r.width, h: r.height } });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zoom (Ctrl/⌘ + scroll ou pinça) e pan (scroll comum / trackpad). Listener não-passivo para poder cancelar o scroll.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".xterm, textarea, .scroll-ok")) {
        if (!(e.ctrlKey || e.metaKey)) return; // rolagem interna do conteúdo
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = vpRef.current;
      if (e.ctrlKey || e.metaKey) setViewport(zoomAt(v, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)));
      else setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Atalhos de teclado
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        space.current = true;
        ref.current?.classList.add("panning");
        e.preventDefault();
      }
      if (isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const v = vpRef.current;
      const c = { x: size.w / 2, y: size.h / 2 };
      if (mod && (e.key === "=" || e.key === "+")) setViewport(zoomAt(v, c.x, c.y, 1.2));
      else if (mod && e.key === "-") setViewport(zoomAt(v, c.x, c.y, 1 / 1.2));
      else if (mod && e.key === "0") setViewport({ ...zoomAt(v, c.x, c.y, 1 / v.zoom) });
      else if (mod && e.key === "1") fitAll();
      else if (e.key === "Delete") {
        const s = ws.nodes.find((n) => n.id === selection);
        if (s) removeNode(s.id);
        else if (selEdge) removeEdge(selEdge);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        space.current = false;
        ref.current?.classList.remove("panning");
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [size, ws.nodes, selection, selEdge]);

  const onBgDown = (e: React.PointerEvent) => {
    const onBg = e.target === ref.current || (e.target as HTMLElement).classList.contains("grid");
    if (!(onBg || space.current || e.button === 1)) return;
    setState({ selection: null, selEdge: null });
    const { x, y } = vp;
    dragWith(e, (dx, dy) => setViewport({ ...vpRef.current, x: x + dx, y: y + dy }));
  };

  const onConnectStart = useCallback((id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const box = ref.current!.getBoundingClientRect();
    setConnecting({ from: id, x: e.clientX - box.left, y: e.clientY - box.top });
    dragWith(
      e,
      (_dx, _dy, ev) => setConnecting({ from: id, x: ev.clientX - box.left, y: ev.clientY - box.top }),
      () => {
        setConnecting(null);
      },
    );
    const finish = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-node-id]") as HTMLElement | null;
      const to = el?.dataset.nodeId;
      if (to && to !== id) addEdge(id, to);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointerup", finish);
  }, []);

  const visibleIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of ws.nodes) if (isVisible(n, vp, size.w, size.h)) s.add(n.id);
    return s;
  }, [ws.nodes, vp, size]);

  const nodeById = useMemo(() => new Map(ws.nodes.map((n) => [n.id, n])), [ws.nodes]);
  const now = Date.now();
  const recent = new Set(activity.filter((a) => now - a.ts < 4000 && a.kind !== "denied").flatMap((a) => [`${a.from}>${a.to}`, `${a.to}>${a.from}`]));

  const edgeEls = ws.edges.map((e) => {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) return null;
    const pa = borderPoint(a, center(b));
    const pb = borderPoint(b, center(a));
    const x1 = pa.x * vp.zoom + vp.x;
    const y1 = pa.y * vp.zoom + vp.y;
    const x2 = pb.x * vp.zoom + vp.x;
    const y2 = pb.y * vp.zoom + vp.y;
    const sel = selEdge === e.id;
    const active = recent.has(`${e.from}>${e.to}`);
    return (
      <g key={e.id} className={`edge ${sel ? "sel" : ""} ${active ? "active" : ""} ${e.confirm ? "confirm" : ""}`}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#arrow)" markerStart={e.bidirectional ? "url(#arrow-start)" : undefined} />
        <line className="hit" x1={x1} y1={y1} x2={x2} y2={y2} onPointerDown={(ev) => { ev.stopPropagation(); setState({ selEdge: e.id, selection: null }); }} />
        <g className="edge-label" transform={`translate(${(x1 + x2) / 2}, ${(y1 + y2) / 2})`}>
          <rect x={-16} y={-10} width={32} height={20} rx={10} />
          <text textAnchor="middle" dominantBaseline="central">
            {(e.bidirectional ? "↔" : "→") + (e.confirm ? "🔒" : "") + (e.allowKeys ? "⌨" : "")}
          </text>
          <title>{`${nodeById.get(e.from)?.title} ${e.bidirectional ? "↔" : "→"} ${nodeById.get(e.to)?.title}${e.confirm ? " (exige confirmação)" : ""}`}</title>
        </g>
      </g>
    );
  });

  const sel = ws.edges.find((e) => e.id === selEdge);
  let popover: React.ReactNode = null;
  if (sel) {
    const a = nodeById.get(sel.from);
    const b = nodeById.get(sel.to);
    if (a && b) {
      const mx = ((a.x + a.w / 2 + b.x + b.w / 2) / 2) * vp.zoom + vp.x;
      const my = ((a.y + a.h / 2 + b.y + b.h / 2) / 2) * vp.zoom + vp.y;
      popover = (
        <div className="edge-pop" style={{ left: mx, top: my }} onPointerDown={(e) => e.stopPropagation()}>
          <label>
            <input type="checkbox" checked={sel.bidirectional} onChange={(e) => updateEdge(sel.id, { bidirectional: e.target.checked })} /> {t("edge.bidirectional")}
          </label>
          <label>
            <input type="checkbox" checked={sel.confirm} onChange={(e) => updateEdge(sel.id, { confirm: e.target.checked })} /> {t("edge.confirm")}
          </label>
          <label title={t("edge.keysHint")}>
            <input type="checkbox" checked={!!sel.allowKeys} onChange={(e) => updateEdge(sel.id, { allowKeys: e.target.checked })} /> {t("edge.keys")}
          </label>
          <button onClick={() => removeEdge(sel.id)}>{t("edge.delete")}</button>
        </div>
      );
    }
  }

  const from = connecting && nodeById.get(connecting.from);
  const g = Math.max(8, settings.grid * vp.zoom);

  return (
    <div className="canvas" ref={ref} onPointerDown={onBgDown}>
      <div className="grid" style={{ backgroundSize: `${g}px ${g}px`, backgroundPosition: `${vp.x}px ${vp.y}px` }} />
      {ws.zones.map((z) => (
        <ZoneView key={z.id} zone={z} zoom={vp.zoom} vx={vp.x} vy={vp.y} snapOn={settings.snap} grid={settings.grid} nodes={ws.nodes} />
      ))}
      <svg className="edges">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
          <marker id="arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M10,0 L0,5 L10,10 z" fill="currentColor" />
          </marker>
        </defs>
        {edgeEls}
        {from && connecting && (
          <line className="rubber" x1={center(from).x * vp.zoom + vp.x} y1={center(from).y * vp.zoom + vp.y} x2={connecting.x} y2={connecting.y} />
        )}
      </svg>
      {ws.nodes.map((n) => {
        const common = { node: n, zoom: vp.zoom, vx: vp.x, vy: vp.y, selected: selection === n.id, snapOn: settings.snap, grid: settings.grid, onConnectStart };
        if (n.kind === "terminal") {
          const profile = profileOf((n as TerminalNode).profileId);
          return <TerminalView key={n.id} {...common} node={n as TerminalNode} profile={profile} visible={visibleIds.has(n.id)} state={states[n.id]} profiles={profiles} />;
        }
        const accent = n.kind === "note" ? "var(--note)" : undefined;
        return (
          <NodeFrame key={n.id} {...common} accent={accent} connectable={n.kind === "note"}>
            {n.kind === "note" && <NoteView node={n} />}
            {n.kind === "sketch" && <SketchView node={n} />}
            {n.kind === "diagram" && <DiagramView node={n} />}
            {n.kind === "file" && <FileView node={n} />}
            {n.kind === "browser" && <BrowserView node={n} />}
          </NodeFrame>
        );
      })}
      {popover}
      <Minimap size={size} />
      <div className="zoom-badge">
        <button className="icon" title="Ctrl −" onClick={() => setViewport(zoomAt(vp, size.w / 2, size.h / 2, 1 / 1.25))}>
          −
        </button>
        <button className="icon zoom-val" title="Ctrl 0 (100%)" onClick={() => setViewport(zoomAt(vp, size.w / 2, size.h / 2, 1 / vp.zoom))}>
          {t("zoom")} {Math.round(vp.zoom * 100)}%
        </button>
        <button className="icon" title="Ctrl +" onClick={() => setViewport(zoomAt(vp, size.w / 2, size.h / 2, 1.25))}>
          +
        </button>
        <button className="icon" title="Ctrl 1" onClick={() => fitAll()}>
          ⤢
        </button>
      </div>
    </div>
  );
}
