import type { Viewport } from "../types";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function worldToScreen(vp: Viewport, x: number, y: number) {
  return { x: x * vp.zoom + vp.x, y: y * vp.zoom + vp.y };
}

export function screenToWorld(vp: Viewport, x: number, y: number) {
  return { x: (x - vp.x) / vp.zoom, y: (y - vp.y) / vp.zoom };
}

/** Zoom mantendo fixo o ponto (px, py) da tela. */
export function zoomAt(vp: Viewport, px: number, py: number, factor: number): Viewport {
  const zoom = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const k = zoom / vp.zoom;
  return { zoom, x: px - (px - vp.x) * k, y: py - (py - vp.y) * k };
}

/** O retângulo (em coordenadas do mundo) aparece na tela, com margem? */
export function isVisible(r: Rect, vp: Viewport, screenW: number, screenH: number, margin = 80): boolean {
  const sx = r.x * vp.zoom + vp.x;
  const sy = r.y * vp.zoom + vp.y;
  const sw = r.w * vp.zoom;
  const sh = r.h * vp.zoom;
  return sx + sw >= -margin && sy + sh >= -margin && sx <= screenW + margin && sy <= screenH + margin;
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Viewport que enquadra todos os retângulos ("zoom to fit"). */
export function fitViewport(rects: Rect[], screenW: number, screenH: number, padding = 60): Viewport {
  const b = boundsOf(rects);
  if (!b || screenW <= 0 || screenH <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = clamp(Math.min((screenW - padding * 2) / b.w, (screenH - padding * 2) / b.h), MIN_ZOOM, 1.5);
  return { zoom, x: (screenW - b.w * zoom) / 2 - b.x * zoom, y: (screenH - b.h * zoom) / 2 - b.y * zoom };
}

/** Centraliza o viewport em um retângulo, mantendo o zoom. */
export function centerOn(r: Rect, vp: Viewport, screenW: number, screenH: number): Viewport {
  return { zoom: vp.zoom, x: screenW / 2 - (r.x + r.w / 2) * vp.zoom, y: screenH / 2 - (r.y + r.h / 2) * vp.zoom };
}

export const snap = (v: number, grid: number, on: boolean) => (on && grid > 0 ? Math.round(v / grid) * grid : v);

/** Ponto na borda do retângulo `r` na direção de `toward` (para ancorar as linhas de conexão). */
export function borderPoint(r: Rect, toward: { x: number; y: number }) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function contains(outer: Rect, inner: Rect): boolean {
  const c = center(inner);
  return c.x >= outer.x && c.x <= outer.x + outer.w && c.y >= outer.y && c.y <= outer.y + outer.h;
}

const overlaps = (a: Rect, b: Rect, gap: number) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** Posição livre (sem sobrepor `others`) mais próxima do centro (cx, cy) para um retângulo w×h. */
export function placeNear(others: Rect[], w: number, h: number, cx: number, cy: number, gap = 24): { x: number; y: number } {
  const stepX = w / 2 + gap;
  const stepY = h / 2 + gap;
  const cands: { x: number; y: number; d: number }[] = [];
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) {
      const x = cx - w / 2 + i * stepX;
      const y = cy - h / 2 + j * stepY;
      cands.push({ x, y, d: Math.hypot(i * stepX, j * stepY) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  const free = cands.find((c) => !others.some((o) => overlaps({ x: c.x, y: c.y, w, h }, o, gap)));
  const p = free ?? cands[0];
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** O retângulo (mundo) está inteiramente dentro da tela? */
export function isFullyVisible(r: Rect, vp: Viewport, screenW: number, screenH: number): boolean {
  const x = r.x * vp.zoom + vp.x;
  const y = r.y * vp.zoom + vp.y;
  return x >= 0 && y >= 0 && x + r.w * vp.zoom <= screenW && y + r.h * vp.zoom <= screenH;
}
