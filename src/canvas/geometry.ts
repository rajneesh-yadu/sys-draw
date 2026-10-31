/** Pure canvas geometry: node size, group rectangles, and which group a point falls in. */
import type { Graph, Position, Rect } from '@/store';

export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 64;
export const GRID = 16;
/** Space between a group's border and its contents; the header sits above the top padding. */
export const GROUP_PADDING = 24;
export const GROUP_HEADER = 28;
export const DEFAULT_GROUP_SIZE = { width: 480, height: 320 } as const;

export function nodeRect(p: Position): Rect {
  return { x: p.x, y: p.y, width: NODE_WIDTH, height: NODE_HEIGHT };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function contains(r: Rect, p: Position): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function center(r: Rect): Position {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Nesting depth of every group (top-level = 0). */
export function groupDepths(graph: Graph): Map<string, number> {
  const parent = new Map(graph.groups.map((g) => [g.id, g.parentId]));
  const depths = new Map<string, number>();
  for (const g of graph.groups) {
    let d = 0;
    let cur = g.parentId;
    const seen = new Set([g.id]);
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      d += 1;
      cur = parent.get(cur);
    }
    depths.set(g.id, d);
  }
  return depths;
}

/**
 * The rectangle each group is drawn with: its stored frame grown to fit its contents (nodes and
 * child groups, plus padding and header). Computed deepest-first so parents fit their children.
 * A group with neither frame nor contents gets DEFAULT_GROUP_SIZE at the origin.
 */
export function computeGroupRects(graph: Graph, frames: Record<string, Rect>): Map<string, Rect> {
  const depths = groupDepths(graph);
  const order = [...graph.groups].sort((a, b) => (depths.get(b.id) ?? 0) - (depths.get(a.id) ?? 0));
  const rects = new Map<string, Rect>();
  for (const g of order) {
    let content: Rect | undefined;
    for (const n of graph.nodes) {
      if (n.groupId !== g.id) continue;
      const r = nodeRect(n.position);
      content = content ? union(content, r) : r;
    }
    for (const c of graph.groups) {
      const r = c.parentId === g.id ? rects.get(c.id) : undefined;
      if (r) content = content ? union(content, r) : r;
    }
    const padded = content && {
      x: content.x - GROUP_PADDING,
      y: content.y - GROUP_PADDING - GROUP_HEADER,
      width: content.width + 2 * GROUP_PADDING,
      height: content.height + 2 * GROUP_PADDING + GROUP_HEADER,
    };
    const frame = frames[g.id];
    rects.set(
      g.id,
      frame && padded
        ? union(frame, padded)
        : (frame ?? padded ?? { x: 0, y: 0, ...DEFAULT_GROUP_SIZE }),
    );
  }
  return rects;
}

/**
 * The innermost group whose rectangle contains `point` (deepest, then smallest), ignoring
 * `exclude` (a dragged group and its descendants). Undefined when the point is on bare canvas.
 */
export function findDropGroup(
  graph: Graph,
  rects: Map<string, Rect>,
  point: Position,
  exclude: ReadonlySet<string> = new Set(),
): string | undefined {
  const depths = groupDepths(graph);
  let best: { id: string; depth: number; area: number } | undefined;
  for (const g of graph.groups) {
    const r = rects.get(g.id);
    if (!r || exclude.has(g.id) || !contains(r, point)) continue;
    const depth = depths.get(g.id) ?? 0;
    const area = r.width * r.height;
    if (!best || depth > best.depth || (depth === best.depth && area < best.area)) {
      best = { id: g.id, depth, area };
    }
  }
  return best?.id;
}

export function snap(v: number, grid = GRID): number {
  return Math.round(v / grid) * grid;
}
