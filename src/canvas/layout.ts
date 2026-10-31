/**
 * Auto-layout with ELK (layered, left → right), groups laid out as compound nodes.
 * ELK (~1.5 MB) is loaded on first use so it stays out of the main bundle.
 */
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { BoardCommand, Graph, NodeMove, Rect } from '@/store';
import { GROUP_HEADER, GROUP_PADDING, NODE_HEIGHT, NODE_WIDTH } from './geometry';

const ROOT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.nodeNode': '40',
  'elk.spacing.componentComponent': '60',
};
const GROUP_OPTIONS = {
  'elk.padding': `[top=${GROUP_PADDING + GROUP_HEADER},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
};

/** ELK input graph for a board. Empty groups keep their current size. */
export function toElkGraph(graph: Graph, rects: Map<string, Rect>): ElkNode {
  const children = (parent: string | undefined): ElkNode[] => [
    ...graph.groups
      .filter((g) => g.parentId === parent)
      .map((g) => {
        const kids = children(g.id);
        const r = rects.get(g.id);
        return {
          id: g.id,
          layoutOptions: GROUP_OPTIONS,
          children: kids,
          ...(kids.length === 0 && r ? { width: r.width, height: r.height } : {}),
        };
      }),
    ...graph.nodes
      .filter((n) => n.groupId === parent)
      .map((n) => ({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
  ];
  return {
    id: 'root',
    layoutOptions: ROOT_OPTIONS,
    children: children(undefined),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

/**
 * One undoable command that moves every node and sets every group frame to the ELK result,
 * offset so the layout starts at `origin`. Positions are absolute.
 */
export async function computeAutoLayout(
  graph: Graph,
  rects: Map<string, Rect>,
  origin = { x: 0, y: 0 },
): Promise<BoardCommand> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const out = await new ELK().layout(toElkGraph(graph, rects));
  const groupIds = new Set(graph.groups.map((g) => g.id));
  const moves: NodeMove[] = [];
  const frames: BoardCommand[] = [];
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = Math.round(ox + (c.x ?? 0));
      const y = Math.round(oy + (c.y ?? 0));
      if (groupIds.has(c.id)) {
        frames.push({
          type: 'setGroupFrame',
          groupId: c.id,
          frame: { x, y, width: Math.round(c.width ?? 0), height: Math.round(c.height ?? 0) },
        });
      } else {
        moves.push({ id: c.id, position: { x, y } });
      }
      walk(c, x, y);
    }
  };
  walk(out, origin.x, origin.y);
  const commands: BoardCommand[] = [...frames];
  if (moves.length > 0) commands.push({ type: 'moveNodes', moves });
  return { type: 'batch', label: 'Auto-layout', commands };
}
