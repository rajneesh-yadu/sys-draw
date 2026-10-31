/** Copy/paste helpers: cut a self-contained subgraph out of a board and clone it with fresh ids. */
import type { IdKind, Position } from '@/core';
import { descendantsOf, nextLabel, stripCounter } from './graph-utils';
import type { BoardDoc, Subgraph } from './types';

/**
 * The selected nodes and groups (groups bring everything inside them) plus the edges whose both
 * ends are included. Links to anything outside the selection (parent groups) are dropped.
 */
export function extractSubgraph(doc: BoardDoc, ids: readonly string[]): Subgraph {
  const { graph } = doc;
  const nodeIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const id of ids) {
    if (graph.nodes.some((n) => n.id === id)) nodeIds.add(id);
    else if (graph.groups.some((g) => g.id === id)) {
      groupIds.add(id);
      const desc = descendantsOf(graph, id);
      desc.nodeIds.forEach((x) => nodeIds.add(x));
      desc.groupIds.forEach((x) => groupIds.add(x));
    }
  }
  const nodes = graph.nodes
    .filter((n) => nodeIds.has(n.id))
    .map((n) => {
      const c = structuredClone(n);
      if (c.groupId !== undefined && !groupIds.has(c.groupId)) delete c.groupId;
      return c;
    });
  const groups = graph.groups
    .filter((g) => groupIds.has(g.id))
    .map((g) => {
      const c = structuredClone(g);
      if (c.parentId !== undefined && !groupIds.has(c.parentId)) delete c.parentId;
      return c;
    });
  const edges = graph.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => structuredClone(e));
  const frames: Subgraph['frames'] = {};
  for (const g of groupIds) {
    const f = doc.layout.groupFrames[g];
    if (f) frames[g] = { ...f };
  }
  return { nodes, edges, groups, frames };
}

/**
 * A copy of `sub` with new ids, shifted by `offset`, with node labels renumbered so they don't
 * clash with `existing` (app-server-1 → app-server-2).
 */
export function cloneSubgraph(
  sub: Subgraph,
  offset: Position,
  newId: (kind: IdKind) => string,
  existing: BoardDoc['graph'],
): Subgraph {
  const map = new Map<string, string>();
  for (const n of sub.nodes) map.set(n.id, newId('node'));
  for (const g of sub.groups) map.set(g.id, newId('group'));
  for (const e of sub.edges) map.set(e.id, newId('edge'));
  const re = (id: string) => map.get(id) as string;

  const labels = { ...existing, nodes: [...existing.nodes] };
  const nodes = sub.nodes.map((n) => {
    const c = structuredClone(n);
    c.id = re(n.id);
    c.label = nextLabel(labels, stripCounter(n.label));
    c.position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
    if (c.groupId !== undefined) c.groupId = re(c.groupId);
    labels.nodes.push(c);
    return c;
  });
  const groups = sub.groups.map((g) => {
    const c = structuredClone(g);
    c.id = re(g.id);
    if (c.parentId !== undefined) c.parentId = re(c.parentId);
    return c;
  });
  const edges = sub.edges.map((e) => ({
    ...structuredClone(e),
    id: re(e.id),
    source: re(e.source),
    target: re(e.target),
  }));
  const frames: Subgraph['frames'] = {};
  for (const [gid, f] of Object.entries(sub.frames)) {
    if (map.has(gid)) frames[re(gid)] = { ...f, x: f.x + offset.x, y: f.y + offset.y };
  }
  return { nodes, edges, groups, frames };
}
