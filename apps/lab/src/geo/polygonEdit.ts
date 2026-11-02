export interface ScreenPoint { x: number; y: number }
export function vertexAt(points: ScreenPoint[], mouse: ScreenPoint, tolerance = 10): number {
  let nearest = -1, distance = tolerance * tolerance;
  points.forEach((p, index) => { const d = (p.x - mouse.x) ** 2 + (p.y - mouse.y) ** 2; if (d <= distance) { nearest = index; distance = d; } });
  return nearest;
}
/** Find the nearest edge, including the closing edge, and snap the insertion to it. */
export function edgeAt(points: ScreenPoint[], mouse: ScreenPoint, tolerance = 10): { index: number; point: ScreenPoint } | null {
  let nearest: ReturnType<typeof edgeAt> = null, distance = tolerance * tolerance;
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((mouse.x - a.x) * dx + (mouse.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (point.x - mouse.x) ** 2 + (point.y - mouse.y) ** 2;
    if (d <= distance) { nearest = { index, point }; distance = d; }
  });
  return nearest;
}
export function insidePolygon(points: ScreenPoint[], mouse: ScreenPoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if ((a.y > mouse.y) !== (b.y > mouse.y) && mouse.x < (b.x - a.x) * (mouse.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
