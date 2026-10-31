/** Small pure helpers over a Graph used by commands and the clipboard. */
import type { Graph } from '@/core';

/** All nodes and groups nested (at any depth) inside `groupId`, excluding the group itself. */
export function descendantsOf(
  graph: Graph,
  groupId: string,
): { nodeIds: Set<string>; groupIds: Set<string> } {
  const groupIds = new Set<string>();
  const queue = [groupId];
  while (queue.length > 0) {
    const cur = queue.pop() as string;
    for (const g of graph.groups) {
      if (g.parentId === cur && !groupIds.has(g.id)) {
        groupIds.add(g.id);
        queue.push(g.id);
      }
    }
  }
  const all = new Set([groupId, ...groupIds]);
  const nodeIds = new Set(
    graph.nodes.filter((n) => n.groupId !== undefined && all.has(n.groupId)).map((n) => n.id),
  );
  return { nodeIds, groupIds };
}

/** Next free `<base>-<n>` label, e.g. app-server-3. */
export function nextLabel(graph: Graph, base: string): string {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  let max = 0;
  for (const n of graph.nodes) {
    const m = re.exec(n.label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base}-${max + 1}`;
}

/** Label base for a component id: the part after the last dot (`compute.app-server` → `app-server`). */
export function labelBase(defId: string): string {
  return defId.slice(defId.lastIndexOf('.') + 1);
}

/**
 * Label base from a component's display name: parentheticals dropped, slugified
 * ("Client (web / mobile)" → "client", "App Server" → "app-server").
 */
export function labelBaseFromName(name: string): string {
  const slug = name
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'node';
}

/** Strip a trailing `-<n>` (`app-server-2` → `app-server`). */
export function stripCounter(label: string): string {
  return label.replace(/-\d+$/, '');
}
