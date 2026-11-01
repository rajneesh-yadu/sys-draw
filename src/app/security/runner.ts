/**
 * Wires the security module to the canvas's security store (S16): recomputes the overlay and the
 * threat review whenever the board changes, and applies a finding's one-click fix as ONE undoable
 * batch of board commands. No security logic here: it maps data and fix plans onto commands.
 */
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type FixHandler,
  type SecurityStore,
  type SecurityView,
} from '@/canvas';
import { newId as coreNewId, type IdKind } from '@/core';
import type { Registry } from '@/registry';
import { reviewSecurity, securityFix, securityOverlay, ZONE_LABEL, type FixPlan } from '@/security';
import type { BoardCommand, BoardDoc, BoardStore } from '@/store';

/** The canvas's view of the security overlay + review of one board. */
export function toSecurityView(
  doc: Pick<BoardDoc, 'graph' | 'scenario'>,
  registry: Registry,
): SecurityView {
  const lookups = {
    components: { get: (id: string) => registry.get(id, 'component') },
    protocols: { get: (id: string) => registry.get(id, 'protocol') },
  };
  const o = securityOverlay(doc.graph, lookups);
  const groups: Record<string, string> = {};
  for (const [id, z] of Object.entries(o.groups)) groups[id] = ZONE_LABEL[z];
  return {
    nodes: o.nodes,
    edges: o.edges,
    groups,
    findings: reviewSecurity({ graph: doc.graph, scenario: doc.scenario, registry }),
  };
}

/**
 * Turns a fix plan into board commands (in order). New ids come from `newId`; a node moved into a
 * new group is placed to the right of its old group's contents so the frames do not overlap.
 */
export function planToCommands(
  plan: FixPlan,
  doc: Pick<BoardDoc, 'graph' | 'layout'>,
  newId: (kind: IdKind) => string = coreNewId,
): BoardCommand[] {
  const { graph } = doc;
  const refs = new Map<string, string>();
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: BoardCommand[] = [];
  for (const s of plan.steps) {
    switch (s.kind) {
      case 'setGroupSecurity':
        out.push({
          type: 'updateGroup',
          groupId: refs.get(s.groupId) ?? s.groupId,
          security: s.security,
        });
        break;
      case 'setEdgeStack':
        out.push({ type: 'updateEdge', edgeId: s.edgeId, protocolStack: s.protocolStack });
        break;
      case 'createGroup': {
        const id = newId('group');
        refs.set(s.ref, id);
        out.push({
          type: 'group',
          kind: s.groupKind,
          memberIds: [],
          label: s.label,
          id,
          ...(s.parentId !== undefined ? { parentId: s.parentId } : {}),
        });
        const members = s.memberIds.map((m) => nodeById.get(m)).filter((n) => n !== undefined);
        const right = (groupId: string | undefined) => {
          if (groupId === undefined) return undefined;
          const xs = graph.nodes
            .filter((n) => n.groupId === groupId)
            .map((n) => n.position.x + NODE_WIDTH);
          const frame = doc.layout.groupFrames[groupId];
          if (frame) xs.push(frame.x + frame.width);
          return xs.length > 0 ? Math.max(...xs) : undefined;
        };
        out.push({
          type: 'moveNodes',
          moves: members.map((n, i) => {
            const r = right(n.groupId);
            return {
              id: n.id,
              position:
                r === undefined
                  ? n.position
                  : { x: r + 80, y: n.position.y + i * (NODE_HEIGHT + 20) },
              groupId: id,
            };
          }),
        });
        out.push({ type: 'updateGroup', groupId: id, security: s.security });
        break;
      }
      case 'insertOnEdge': {
        const edge = graph.edges.find((e) => e.id === s.edgeId);
        const a = edge && nodeById.get(edge.source);
        const b = edge && nodeById.get(edge.target);
        if (!edge || !a || !b) throw new Error('The connection to protect no longer exists');
        const id = newId('node');
        out.push({
          type: 'addNode',
          defId: s.defId,
          label: s.label,
          id,
          position: {
            x: Math.round((a.position.x + b.position.x) / 2),
            y: Math.round((a.position.y + b.position.y) / 2) + NODE_HEIGHT + 20,
          },
        });
        out.push({ type: 'delete', ids: [edge.id] });
        out.push({ type: 'connect', source: a.id, target: id, id: newId('edge') });
        out.push({ type: 'connect', source: id, target: b.id, id: newId('edge') });
        break;
      }
      case 'addNode': {
        const near = nodeById.get(s.near);
        if (!near) throw new Error('The component to add it next to no longer exists');
        const id = newId('node');
        out.push({
          type: 'addNode',
          defId: s.defId,
          label: s.label,
          id,
          position: { x: near.position.x, y: near.position.y + NODE_HEIGHT + 60 },
        });
        for (const from of s.connectFrom)
          out.push({ type: 'connect', source: from, target: id, id: newId('edge') });
        break;
      }
      // S19 (design review fixes)
      case 'setNodeConfig':
        out.push({ type: 'updateConfig', nodeId: s.nodeId, config: s.config });
        break;
      case 'setNodeScaling':
        out.push({
          type: 'updateNode',
          nodeId: s.nodeId,
          scaling: {
            ...(s.replicas !== undefined ? { replicas: s.replicas } : {}),
            ...(s.autoscale !== undefined ? { autoscale: s.autoscale } : {}),
          },
        });
        break;
      case 'setEdgeConfig':
        out.push({ type: 'updateEdge', edgeId: s.edgeId, config: s.config });
        break;
    }
  }
  return out;
}

/** Applies the fix of the finding `key` on the board store's open board (one undo step). */
export function applySecurityFix(
  boardStore: BoardStore,
  registry: Registry,
  key: string,
  newId?: (kind: IdKind) => string,
): ReturnType<FixHandler> {
  const { doc } = boardStore.getState();
  const plan = securityFix({ graph: doc.graph, scenario: doc.scenario, registry }, key);
  if (!plan)
    return { ok: false, reason: 'This finding has no automatic fix any more (the board changed).' };
  let commands: BoardCommand[];
  try {
    commands = planToCommands(plan, doc, newId);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const r = boardStore.getState().dispatch({ type: 'batch', label: plan.label, commands });
  return r.ok ? { ok: true, label: plan.label } : { ok: false, reason: r.reason };
}

export interface SecurityRunnerOptions {
  boardStore: BoardStore;
  securityStore: SecurityStore;
  registry: Registry;
}

/** Keeps the security view in step with the open board and registers the fix handler. */
export function startSecurityRunner(opts: SecurityRunnerOptions): { dispose(): void } {
  const { boardStore, securityStore, registry } = opts;
  const refresh = () => {
    const { doc } = boardStore.getState();
    let view: SecurityView | null;
    try {
      view = toSecurityView(doc, registry);
    } catch {
      view = null;
    }
    securityStore.getState().setView(view);
  };
  securityStore.getState().setFixHandler((key) => applySecurityFix(boardStore, registry, key));
  refresh();
  const unsub = boardStore.subscribe((s, prev) => {
    if (s.doc.graph !== prev.doc.graph || s.doc.scenario !== prev.doc.scenario) refresh();
  });
  return {
    dispose() {
      unsub();
      securityStore.getState().setFixHandler(null);
    },
  };
}
