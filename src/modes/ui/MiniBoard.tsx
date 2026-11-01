/**
 * A lesson's mini-board drawn as a static SVG (modes may not use the canvas module): nodes as
 * labelled boxes, edges as lines, the current step's focus ids highlighted.
 */
import type { Graph } from '@/store';

const W = 150;
const H = 44;
const PAD = 16;

export function MiniBoard({ graph, focusIds = [] }: { graph: Graph; focusIds?: string[] }) {
  if (graph.nodes.length === 0) return null;
  const xs = graph.nodes.map((n) => n.position.x);
  const ys = graph.nodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX + W + 2 * PAD;
  const height = Math.max(...ys) - minY + H + 2 * PAD;
  const pos = new Map(
    graph.nodes.map((n) => [n.id, { x: n.position.x - minX + PAD, y: n.position.y - minY + PAD }]),
  );
  const focus = new Set(focusIds);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Mini-board: ${graph.nodes.map((n) => n.label).join(', ')}`}
      className="w-full rounded border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
      data-testid="mini-board"
    >
      {graph.edges.map((e) => {
        const a = pos.get(e.source);
        const b = pos.get(e.target);
        if (!a || !b) return null;
        const on = focus.has(e.id);
        return (
          <line
            key={e.id}
            x1={a.x + W}
            y1={a.y + H / 2}
            x2={b.x}
            y2={b.y + H / 2}
            strokeWidth={on ? 3 : 1.5}
            strokeDasharray={e.sync ? undefined : '5 4'}
            className={on ? 'stroke-amber-500' : 'stroke-slate-400'}
            data-focus={on || undefined}
          />
        );
      })}
      {graph.nodes.map((n) => {
        const p = pos.get(n.id)!;
        const on = focus.has(n.id);
        return (
          <g key={n.id} data-focus={on || undefined}>
            <rect
              x={p.x}
              y={p.y}
              width={W}
              height={H}
              rx={6}
              strokeWidth={on ? 3 : 1}
              className={
                on
                  ? 'fill-amber-50 stroke-amber-500 dark:fill-amber-950'
                  : 'fill-white stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600'
              }
            />
            <text
              x={p.x + W / 2}
              y={p.y + H / 2 + 4}
              textAnchor="middle"
              className="fill-slate-700 text-[11px] dark:fill-slate-200"
            >
              {n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
