/** Map store state to React Flow nodes and edges (pure; React Flow positions are parent-relative). */
import type { Edge, Node } from '@xyflow/react';
import type { Registry } from '@/registry';
import { groupKindLabel, type BoardDoc, type GroupKind, type Rect } from '@/store';
import { groupDepths, NODE_HEIGHT, NODE_WIDTH } from './geometry';

export interface PortView {
  id: string;
  direction: 'in' | 'out' | 'both';
  protocols: readonly string[];
}

export interface ComponentNodeData extends Record<string, unknown> {
  label: string;
  defId: string;
  /** Provider-specific product name, e.g. "Elastic Load Balancing (ALB)". */
  name: string;
  icon: string;
  replicas: number;
  ports: readonly PortView[];
  known: boolean;
}

export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  kind: GroupKind;
  kindLabel: string;
}

export type ComponentFlowNode = Node<ComponentNodeData, 'component'>;
export type GroupFlowNode = Node<GroupNodeData, 'sdGroup'>;
export type FlowNode = ComponentFlowNode | GroupFlowNode;

export interface ProtocolEdgeData extends Record<string, unknown> {
  stack: readonly string[];
  sync: boolean;
}
export type FlowEdge = Edge<ProtocolEdgeData>;

export function toFlowNodes(
  doc: BoardDoc,
  rects: Map<string, Rect>,
  selection: ReadonlySet<string>,
  registry: Registry,
): FlowNode[] {
  const { graph } = doc;
  const depths = groupDepths(graph);
  const rel = (abs: { x: number; y: number }, parentId: string | undefined) => {
    const p = parentId === undefined ? undefined : rects.get(parentId);
    return p ? { x: abs.x - p.x, y: abs.y - p.y } : { x: abs.x, y: abs.y };
  };

  // React Flow needs parents before children.
  const groups: GroupFlowNode[] = [...graph.groups]
    .sort((a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0))
    .map((g) => {
      const r = rects.get(g.id) as Rect;
      return {
        id: g.id,
        type: 'sdGroup',
        position: rel(r, g.parentId),
        ...(g.parentId !== undefined ? { parentId: g.parentId } : {}),
        width: r.width,
        height: r.height,
        style: { width: r.width, height: r.height },
        zIndex: -100 + (depths.get(g.id) ?? 0),
        dragHandle: '.sd-group-header',
        selected: selection.has(g.id),
        data: { label: g.label, kind: g.kind, kindLabel: groupKindLabel(g.kind) },
      };
    });

  const nodes: ComponentFlowNode[] = graph.nodes.map((n) => {
    const def = registry.get(n.defId, 'component');
    const name = def ? (def.providerNames?.[doc.providerId] ?? def.name) : n.defId;
    return {
      id: n.id,
      type: 'component',
      position: rel(n.position, n.groupId),
      ...(n.groupId !== undefined ? { parentId: n.groupId } : {}),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      selected: selection.has(n.id),
      data: {
        label: n.label,
        defId: n.defId,
        name,
        icon: def?.icon ?? 'box',
        replicas: n.scaling.replicas,
        ports: def?.ports ?? [],
        known: def !== undefined,
      },
    };
  });

  return [...groups, ...nodes];
}

export function toFlowEdges(
  doc: BoardDoc,
  selection: ReadonlySet<string>,
  registry: Registry,
): FlowEdge[] {
  return doc.graph.edges.map((e) => {
    const top = e.protocolStack[e.protocolStack.length - 1];
    const label = top === undefined ? '' : (registry.get(top, 'protocol')?.name ?? top);
    return {
      id: e.id,
      type: 'sdEdge',
      source: e.source,
      target: e.target,
      ...(e.sourcePortId !== undefined ? { sourceHandle: e.sourcePortId } : {}),
      ...(e.targetPortId !== undefined ? { targetHandle: e.targetPortId } : {}),
      label,
      animated: !e.sync,
      selected: selection.has(e.id),
      data: { stack: e.protocolStack, sync: e.sync },
    };
  });
}
