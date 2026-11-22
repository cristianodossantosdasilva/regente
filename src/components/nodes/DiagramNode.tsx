import { useRef, useState } from "react";
import { updateNode } from "../../actions";
import { borderPoint, center } from "../../lib/geometry";
import { t } from "../../lib/i18n";
import { uid } from "../../lib/workspace";
import { askText } from "../../store";
import type { DiagramBox, DiagramNode } from "../../types";

export function DiagramView({ node }: { node: DiagramNode }) {
  const [sel, setSel] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const BAR = 30;
  const byId = new Map(node.boxes.map((b) => [b.id, b]));

  const toLocal = (e: React.PointerEvent) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  const setBoxes = (boxes: DiagramBox[]) => updateNode(node.id, { boxes });

  const addBox = () => {
    const id = uid("b");
    setBoxes([...node.boxes, { id, x: 30 + node.boxes.length * 20, y: 30 + node.boxes.length * 20, w: 120, h: 50, text: "Caixa" }]);
    setSel(id);
  };

  const boxDown = (e: React.PointerEvent, b: DiagramBox) => {
    e.stopPropagation();
    if (linking && sel && sel !== b.id) {
      if (!node.links.some((l) => l.from === sel && l.to === b.id)) updateNode(node.id, { links: [...node.links, { from: sel, to: b.id }] });
      setLinking(false);
      return;
    }
    setSel(b.id);
    const start = toLocal(e);
    const { x, y } = b;
    const move = (ev: PointerEvent) => {
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
      setBoxes(node.boxes.map((o) => (o.id === b.id ? { ...o, x: Math.round(x + p.x - start.x), y: Math.round(y + p.y - start.y) } : o)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const edit = async (b: DiagramBox) => {
    const v = await askText(t("node.rename"), b.text);
    if (v !== null) setBoxes(node.boxes.map((o) => (o.id === b.id ? { ...o, text: v } : o)));
  };

  const del = () => {
    if (!sel) return;
    updateNode(node.id, { boxes: node.boxes.filter((b) => b.id !== sel), links: node.links.filter((l) => l.from !== sel && l.to !== sel) });
    setSel(null);
  };

  return (
    <div className="sketch">
      <div className="sketch-bar" style={{ height: BAR }}>
        <button onClick={addBox}>+ {t("diagram.addBox")}</button>
        <button className={linking ? "on" : ""} disabled={!sel} onClick={() => setLinking(!linking)}>
          {t("diagram.link")}
        </button>
        <button disabled={!sel} onClick={del}>
          {t("diagram.delete")}
        </button>
      </div>
      <svg ref={svg} width={node.w} height={node.h - 30 - BAR} onPointerDown={() => { setSel(null); setLinking(false); }}>
        <defs>
          <marker id={`da-${node.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#9aa3b8" />
          </marker>
        </defs>
        {node.links.map((l, i) => {
          const a = byId.get(l.from);
          const b = byId.get(l.to);
          if (!a || !b) return null;
          const p1 = borderPoint(a, center(b));
          const p2 = borderPoint(b, center(a));
          return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#9aa3b8" strokeWidth={2} markerEnd={`url(#da-${node.id})`} />;
        })}
        {node.boxes.map((b) => (
          <g key={b.id} onPointerDown={(e) => boxDown(e, b)} onDoubleClick={() => void edit(b)} style={{ cursor: "move" }}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} className={`dbox ${sel === b.id ? "sel" : ""}`} />
            <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dominantBaseline="middle" className="dtext">
              {b.text}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
