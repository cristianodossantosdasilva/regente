import { memo, ReactNode } from "react";
import { addEdge, bringToFront, removeNode, updateNode } from "../actions";
import { snap } from "../lib/geometry";
import { t } from "../lib/i18n";
import { askText, setState } from "../store";
import type { AnyNode } from "../types";
import { dragWith } from "./drag";

export const HDR = 30;
const MIN_W = 260;
const MIN_H = 160;

interface Props {
  node: AnyNode;
  zoom: number;
  vx: number;
  vy: number;
  selected: boolean;
  snapOn: boolean;
  grid: number;
  accent?: string;
  headerExtra?: ReactNode;
  /** Conteúdo "livre" (terminal): recebe o tamanho em pixels de tela. Os demais são escalados por CSS. */
  raw?: (w: number, h: number) => ReactNode;
  children?: ReactNode;
  connectable: boolean;
  onConnectStart: (id: string, e: React.PointerEvent) => void;
}

function NodeFrameInner({ node, zoom, vx, vy, selected, snapOn, grid, accent, headerExtra, raw, children, connectable, onConnectStart }: Props) {
  const left = node.x * zoom + vx;
  const top = node.y * zoom + vy;
  const w = node.w * zoom;
  const h = node.h * zoom;

  const startMove = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    const { x, y } = node;
    dragWith(e, (dx, dy) => updateNode(node.id, { x: snap(x + dx / zoom, grid, snapOn), y: snap(y + dy / zoom, grid, snapOn) }));
  };

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const { w: w0, h: h0 } = node;
    dragWith(e, (dx, dy) =>
      updateNode(node.id, { w: Math.max(MIN_W, snap(w0 + dx / zoom, grid, snapOn)), h: Math.max(MIN_H, snap(h0 + dy / zoom, grid, snapOn)) }),
    );
  };

  const rename = async () => {
    const v = await askText(t("node.rename"), node.title);
    if (v && v.trim()) updateNode(node.id, { title: v.trim() });
  };

  return (
    <div
      className={`node ${selected ? "selected" : ""}`}
      data-node-id={node.id}
      style={{ left, top, width: w, height: h, zIndex: 10 + node.z, ["--accent" as string]: accent ?? "var(--border-strong)" }}
      onPointerDown={() => {
        setState({ selection: node.id, selEdge: null });
        bringToFront(node.id);
      }}
    >
      <div className="node-hdr-wrap" style={{ height: HDR * zoom }}>
        <div className="node-hdr" style={{ width: node.w, height: HDR, transform: `scale(${zoom})` }} onPointerDown={startMove} onDoubleClick={rename}>
          <span className="dot" style={{ background: accent ?? "var(--muted)" }} />
          <span className="title" title={node.title}>
            {node.title}
          </span>
          {headerExtra}
          <button className="icon" title={t("node.close")} onClick={() => removeNode(node.id)}>
            ×
          </button>
        </div>
      </div>
      <div className="node-body" style={{ top: HDR * zoom, width: w, height: h - HDR * zoom }}>
        {raw ? (
          raw(w, h - HDR * zoom)
        ) : (
          <div className="scaled" style={{ width: node.w, height: node.h - HDR, transform: `scale(${zoom})` }}>
            {children}
          </div>
        )}
      </div>
      <div className="resize" onPointerDown={startResize} />
      {connectable && <div className="connect" title="Arraste até outro nó para conectar" onPointerDown={(e) => onConnectStart(node.id, e)} />}
    </div>
  );
}

export const NodeFrame = memo(NodeFrameInner);
export { addEdge };
