import { setViewport } from "../actions";
import { boundsOf } from "../lib/geometry";
import { useStore } from "../store";
import { dragWith } from "./drag";

const W = 190;
const H = 120;

export function Minimap({ size }: { size: { w: number; h: number } }) {
  const ws = useStore((s) => s.ws)!;
  const vp = ws.viewport;
  const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: size.w / vp.zoom, h: size.h / vp.zoom };
  const rects = [...ws.nodes, ...ws.zones, view];
  const b = boundsOf(rects)!;
  const pad = 40;
  const k = Math.min(W / (b.w + pad * 2), H / (b.h + pad * 2));
  const ox = (W - (b.w + pad * 2) * k) / 2 - (b.x - pad) * k;
  const oy = (H - (b.h + pad * 2) * k) / 2 - (b.y - pad) * k;

  const go = (e: React.PointerEvent) => {
    const el = e.currentTarget as SVGElement;
    const move = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      const wx = (cx - r.left - ox) / k;
      const wy = (cy - r.top - oy) / k;
      setViewport({ ...vp, x: size.w / 2 - wx * vp.zoom, y: size.h / 2 - wy * vp.zoom });
    };
    move(e.clientX, e.clientY);
    dragWith(e, (_dx, _dy, ev) => move(ev.clientX, ev.clientY));
  };

  return (
    <svg className="minimap" width={W} height={H} onPointerDown={go}>
      {ws.zones.map((z) => (
        <rect key={z.id} x={z.x * k + ox} y={z.y * k + oy} width={z.w * k} height={z.h * k} fill={z.color} opacity={0.15} />
      ))}
      {ws.nodes.map((n) => (
        <rect key={n.id} x={n.x * k + ox} y={n.y * k + oy} width={Math.max(2, n.w * k)} height={Math.max(2, n.h * k)} fill={n.kind === "terminal" ? "#7c9cff" : "#ffb454"} opacity={0.75} />
      ))}
      <rect className="mm-view" x={view.x * k + ox} y={view.y * k + oy} width={view.w * k} height={view.h * k} />
    </svg>
  );
}
