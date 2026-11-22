import { useRef, useState } from "react";
import { updateNode } from "../../actions";
import { t } from "../../lib/i18n";
import { askText } from "../../store";
import type { Shape, SketchNode } from "../../types";

type Tool = "pen" | "rect" | "arrow" | "text";
const COLORS = ["#e6e8ee", "#ff7a90", "#ffb454", "#7bd88f", "#7c9cff"];

function ShapeEl({ s }: { s: Shape }) {
  switch (s.t) {
    case "pen": {
      const pts = [];
      for (let i = 0; i < s.pts.length; i += 2) pts.push(`${s.pts[i]},${s.pts[i + 1]}`);
      return <polyline points={pts.join(" ")} fill="none" stroke={s.c} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />;
    }
    case "rect":
      return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke={s.c} strokeWidth={2.5} rx={3} />;
    case "arrow": {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const h = 12;
      const p1 = `${s.x2 - h * Math.cos(a - 0.45)},${s.y2 - h * Math.sin(a - 0.45)}`;
      const p2 = `${s.x2 - h * Math.cos(a + 0.45)},${s.y2 - h * Math.sin(a + 0.45)}`;
      return (
        <g stroke={s.c} strokeWidth={2.5} strokeLinecap="round" fill="none">
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
          <polyline points={`${p1} ${s.x2},${s.y2} ${p2}`} />
        </g>
      );
    }
    default:
      return (
        <text x={s.x} y={s.y} fill={s.c} fontSize={16} fontFamily="system-ui, sans-serif">
          {s.text}
        </text>
      );
  }
}

export function SketchView({ node }: { node: SketchNode }) {
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const BAR = 30;

  // Converte a posição do ponteiro para coordenadas do desenho, mesmo com o nó escalado por CSS.
  const pt = (e: React.PointerEvent) => {
    const el = svg.current!;
    const m = el.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };

  const down = async (e: React.PointerEvent) => {
    e.stopPropagation();
    const p = pt(e);
    if (tool === "text") {
      const text = await askText(t("sketch.text"), "");
      if (text) updateNode(node.id, { shapes: [...node.shapes, { t: "text", x: p.x, y: p.y, text, c: color }] });
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (tool === "pen") setDraft({ t: "pen", pts: [p.x, p.y], c: color });
    if (tool === "rect") setDraft({ t: "rect", x: p.x, y: p.y, w: 0, h: 0, c: color });
    if (tool === "arrow") setDraft({ t: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: color });
  };
  const move = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = pt(e);
    if (draft.t === "pen") setDraft({ ...draft, pts: [...draft.pts, p.x, p.y] });
    else if (draft.t === "rect") setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y });
    else if (draft.t === "arrow") setDraft({ ...draft, x2: p.x, y2: p.y });
  };
  const up = () => {
    if (draft) {
      let s = draft;
      if (s.t === "rect") s = { ...s, x: s.w < 0 ? s.x + s.w : s.x, y: s.h < 0 ? s.y + s.h : s.y, w: Math.abs(s.w), h: Math.abs(s.h) };
      updateNode(node.id, { shapes: [...node.shapes, s] });
      setDraft(null);
    }
  };

  return (
    <div className="sketch">
      <div className="sketch-bar" style={{ height: BAR }}>
        {(["pen", "rect", "arrow", "text"] as Tool[]).map((k) => (
          <button key={k} className={tool === k ? "on" : ""} onClick={() => setTool(k)}>
            {t(`sketch.${k}`)}
          </button>
        ))}
        {COLORS.map((c) => (
          <span key={c} className={`swatch ${c === color ? "on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
        <button onClick={() => updateNode(node.id, { shapes: node.shapes.slice(0, -1) })}>{t("sketch.undo")}</button>
        <button onClick={() => updateNode(node.id, { shapes: [] })}>{t("sketch.clear")}</button>
      </div>
      <svg ref={svg} width={node.w} height={node.h - 30 - BAR} onPointerDown={down} onPointerMove={move} onPointerUp={up} style={{ touchAction: "none", cursor: "crosshair" }}>
        {node.shapes.map((s, i) => (
          <ShapeEl key={i} s={s} />
        ))}
        {draft && <ShapeEl s={draft} />}
      </svg>
    </div>
  );
}
