/**
 * The command bus vocabulary. Every board edit is one of these plain-data commands; the store
 * applies it to an Immer draft and records the patches + inverse patches for undo/redo.
 */
import type { Draft } from 'immer';
import {
  GROUP_KINDS,
  safeParseReadable,
  type EdgeInstance,
  type GroupKind,
  type IdKind,
  type NodeInstance,
  type Position,
} from '@/core';
import type { Registry } from '@/registry';
import { checkConnection, defaultProtocolStack } from './connections';
import { descendantsOf, labelBase, labelBaseFromName, nextLabel } from './graph-utils';
import type { BoardDoc, Rect, Subgraph } from './types';

export interface NodeMove {
  id: string;
  position: Position;
  /** New parent group; `null` moves the node out of any group; omit to keep it. */
  groupId?: string | null;
}

export type BoardCommand =
  | {
      type: 'addNode';
      defId: string;
      position: Position;
      groupId?: string;
      label?: string;
      id?: string;
    }
  | { type: 'moveNodes'; moves: NodeMove[] }
  | { type: 'moveGroup'; groupId: string; dx: number; dy: number; parentId?: string | null }
  | {
      type: 'connect';
      source: string;
      target: string;
      sourcePortId?: string;
      targetPortId?: string;
      /** Application protocol; defaults to the best shared one. */
      protocol?: string;
      id?: string;
    }
  | { type: 'delete'; ids: string[] }
  | { type: 'updateConfig'; nodeId: string; config: Record<string, unknown> }
  | {
      type: 'group';
      kind: GroupKind;
      /** Node and/or group ids to put inside; may be empty (a group dropped from the palette). */
      memberIds: string[];
      label?: string;
      frame?: Rect;
      /** Explicit parent; defaults to the members' common parent. */
      parentId?: string;
      id?: string;
    }
  | { type: 'ungroup'; groupId: string }
  | { type: 'setGroupFrame'; groupId: string; frame: Rect }
  | { type: 'insert'; subgraph: Subgraph }
  | { type: 'batch'; label: string; commands: BoardCommand[] };

export interface CommandContext {
  registry: Registry;
  newId: (kind: IdKind) => string;
}

/** Thrown by a command that cannot apply; the store turns it into `{ ok: false, reason }`. */
export class CommandError extends Error {
  override name = 'CommandError';
}

const fail = (msg: string): never => {
  throw new CommandError(msg);
};

const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  region: 'Region',
  az: 'AZ',
  vpc: 'VPC',
  subnet: 'Subnet',
  cluster: 'Cluster',
};

export function groupKindLabel(kind: GroupKind): string {
  return GROUP_KIND_LABELS[kind];
}

/** Human-readable label for the undo/redo history. */
export function commandLabel(cmd: BoardCommand): string {
  switch (cmd.type) {
    case 'addNode':
      return `Add ${labelBase(cmd.defId)}`;
    case 'moveNodes':
      return cmd.moves.length === 1 ? 'Move node' : `Move ${cmd.moves.length} nodes`;
    case 'moveGroup':
      return 'Move group';
    case 'connect':
      return 'Connect';
    case 'delete':
      return cmd.ids.length === 1 ? 'Delete' : `Delete ${cmd.ids.length} items`;
    case 'updateConfig':
      return 'Change config';
    case 'group':
      return `Group as ${groupKindLabel(cmd.kind)}`;
    case 'ungroup':
      return 'Ungroup';
    case 'setGroupFrame':
      return 'Resize group';
    case 'insert':
      return 'Paste';
    case 'batch':
      return cmd.label;
  }
}

type D = Draft<BoardDoc>;

const findNode = (d: D, id: string) => d.graph.nodes.find((n) => n.id === id);
const findGroup = (d: D, id: string) => d.graph.groups.find((g) => g.id === id);
const requireGroup = (d: D, id: string) => findGroup(d, id) ?? fail(`Unknown group "${id}"`);

function setNodeGroup(n: Draft<NodeInstance>, groupId: string | undefined) {
  if (groupId === undefined) delete n.groupId;
  else n.groupId = groupId;
}

function shiftFrame(d: D, id: string, dx: number, dy: number) {
  const f = d.layout.groupFrames[id];
  if (f) {
    f.x += dx;
    f.y += dy;
  }
}

/** Apply one command to the draft. Throws CommandError when it cannot apply. */
export function applyCommand(d: D, cmd: BoardCommand, ctx: CommandContext): void {
  switch (cmd.type) {
    case 'addNode': {
      const def =
        ctx.registry.get(cmd.defId, 'component') ?? fail(`Unknown component "${cmd.defId}"`);
      if (cmd.groupId !== undefined) requireGroup(d, cmd.groupId);
      const id = cmd.id ?? ctx.newId('node');
      if (findNode(d, id)) fail(`Duplicate node id "${id}"`);
      const node: NodeInstance = {
        id,
        defId: def.id,
        label: cmd.label ?? nextLabel(d.graph, labelBaseFromName(def.name)),
        position: { x: cmd.position.x, y: cmd.position.y },
        ...(cmd.groupId !== undefined ? { groupId: cmd.groupId } : {}),
        config: structuredClone(def.defaults) as Record<string, unknown>,
        scaling: { replicas: 1, instanceType: (def.instanceTypes[0] as { id: string }).id },
      };
      d.graph.nodes.push(node);
      return;
    }

    case 'moveNodes': {
      for (const m of cmd.moves) {
        const n = findNode(d, m.id) ?? fail(`Unknown node "${m.id}"`);
        n.position = { x: m.position.x, y: m.position.y };
        if (m.groupId === null) setNodeGroup(n, undefined);
        else if (m.groupId !== undefined) {
          requireGroup(d, m.groupId);
          setNodeGroup(n, m.groupId);
        }
      }
      return;
    }

    case 'moveGroup': {
      const g = requireGroup(d, cmd.groupId);
      const { nodeIds, groupIds } = descendantsOf(d.graph, g.id);
      if (cmd.parentId !== undefined && cmd.parentId !== null) {
        if (cmd.parentId === g.id || groupIds.has(cmd.parentId)) {
          fail('A group cannot be placed inside itself');
        }
        requireGroup(d, cmd.parentId);
      }
      shiftFrame(d, g.id, cmd.dx, cmd.dy);
      for (const gid of groupIds) shiftFrame(d, gid, cmd.dx, cmd.dy);
      for (const n of d.graph.nodes) {
        if (nodeIds.has(n.id)) n.position = { x: n.position.x + cmd.dx, y: n.position.y + cmd.dy };
      }
      if (cmd.parentId === null) delete g.parentId;
      else if (cmd.parentId !== undefined) g.parentId = cmd.parentId;
      return;
    }

    case 'connect': {
      const check = checkConnection(ctx.registry, d.graph as BoardDoc['graph'], cmd);
      if (!check.ok) return fail(check.reason);
      const protocol = cmd.protocol ?? check.protocols[0];
      if (protocol === undefined || !check.protocols.includes(protocol)) {
        fail(`Protocol "${String(protocol)}" is not shared by both ports`);
      }
      const target = findNode(d, cmd.target) as NodeInstance;
      const targetDef = ctx.registry.get(target.defId, 'component');
      const id = cmd.id ?? ctx.newId('edge');
      if (d.graph.edges.some((e) => e.id === id)) fail(`Duplicate edge id "${id}"`);
      const edge: EdgeInstance = {
        id,
        source: cmd.source,
        target: cmd.target,
        sourcePortId: check.sourcePortId,
        targetPortId: check.targetPortId,
        protocolStack: defaultProtocolStack(ctx.registry, protocol as string),
        // Fire-and-forget into a queue; request/response everywhere else.
        sync: !(targetDef?.behaviors ?? []).includes('queue'),
        config: {},
      };
      d.graph.edges.push(edge);
      return;
    }

    case 'delete': {
      const ids = new Set(cmd.ids);
      const nodes = new Set<string>();
      const groups = new Set<string>();
      for (const id of ids) {
        if (findNode(d, id)) nodes.add(id);
        else if (findGroup(d, id)) {
          groups.add(id);
          const desc = descendantsOf(d.graph, id);
          desc.nodeIds.forEach((x) => nodes.add(x));
          desc.groupIds.forEach((x) => groups.add(x));
        }
      }
      const edgesBefore = d.graph.edges.length;
      d.graph.edges = d.graph.edges.filter(
        (e) => !ids.has(e.id) && !nodes.has(e.source) && !nodes.has(e.target),
      );
      if (nodes.size === 0 && groups.size === 0 && d.graph.edges.length === edgesBefore) {
        fail('Nothing to delete');
      }
      d.graph.nodes = d.graph.nodes.filter((n) => !nodes.has(n.id));
      d.graph.groups = d.graph.groups.filter((g) => !groups.has(g.id));
      for (const g of groups) delete d.layout.groupFrames[g];
      return;
    }

    case 'updateConfig': {
      const n = findNode(d, cmd.nodeId) ?? fail(`Unknown node "${cmd.nodeId}"`);
      const merged = { ...(n.config as Record<string, unknown>), ...cmd.config };
      const def = ctx.registry.get(n.defId, 'component');
      if (def) {
        const res = safeParseReadable(def.configSchema, merged);
        if (!res.ok) fail(`Invalid config for ${n.label}: ${res.errors.join('; ')}`);
      }
      n.config = merged;
      return;
    }

    case 'group': {
      if (!(GROUP_KINDS as readonly string[]).includes(cmd.kind)) {
        fail(`Unknown group kind "${cmd.kind}"`);
      }
      const id = cmd.id ?? ctx.newId('group');
      if (findGroup(d, id)) fail(`Duplicate group id "${id}"`);
      const memberNodes = [];
      const memberGroups = [];
      for (const m of new Set(cmd.memberIds)) {
        const n = findNode(d, m);
        const g = n ? undefined : findGroup(d, m);
        if (n) memberNodes.push(n);
        else if (g) memberGroups.push(g);
        else fail(`Unknown node or group "${m}"`);
      }
      // A member group's descendants are carried along; listing them too would flatten nesting.
      const memberGroupIds = new Set(memberGroups.map((g) => g.id));
      const nested = new Set<string>();
      for (const g of memberGroups) {
        const desc = descendantsOf(d.graph, g.id);
        desc.groupIds.forEach((x) => nested.add(x));
        desc.nodeIds.forEach((x) => nested.add(x));
      }
      const nodes = memberNodes.filter((n) => !nested.has(n.id));
      const groups = memberGroups.filter((g) => !nested.has(g.id));

      let parentId = cmd.parentId;
      if (parentId !== undefined) {
        requireGroup(d, parentId);
        if (memberGroupIds.has(parentId) || nested.has(parentId)) {
          fail('A group cannot be placed inside itself');
        }
      } else {
        const parents = new Set<string | undefined>([
          ...nodes.map((n) => n.groupId),
          ...groups.map((g) => g.parentId),
        ]);
        const only = parents.size === 1 ? [...parents][0] : undefined;
        if (only !== undefined) parentId = only;
      }

      const sameKind = d.graph.groups.filter((g) => g.kind === cmd.kind).length;
      d.graph.groups.push({
        id,
        kind: cmd.kind,
        label: cmd.label ?? `${groupKindLabel(cmd.kind)} ${sameKind + 1}`,
        ...(parentId !== undefined ? { parentId } : {}),
      });
      for (const n of nodes) n.groupId = id;
      for (const g of groups) g.parentId = id;
      if (cmd.frame) d.layout.groupFrames[id] = { ...cmd.frame };
      return;
    }

    case 'ungroup': {
      const g = requireGroup(d, cmd.groupId);
      const parent = g.parentId;
      for (const n of d.graph.nodes) if (n.groupId === g.id) setNodeGroup(n, parent);
      for (const c of d.graph.groups) {
        if (c.parentId !== g.id) continue;
        if (parent === undefined) delete c.parentId;
        else c.parentId = parent;
      }
      d.graph.groups = d.graph.groups.filter((x) => x.id !== g.id);
      delete d.layout.groupFrames[g.id];
      return;
    }

    case 'setGroupFrame': {
      requireGroup(d, cmd.groupId);
      if (!(cmd.frame.width > 0 && cmd.frame.height > 0)) fail('Group size must be positive');
      d.layout.groupFrames[cmd.groupId] = { ...cmd.frame };
      return;
    }

    case 'insert': {
      const s = cmd.subgraph;
      const taken = new Set([
        ...d.graph.nodes.map((n) => n.id),
        ...d.graph.edges.map((e) => e.id),
        ...d.graph.groups.map((g) => g.id),
      ]);
      for (const x of [...s.nodes, ...s.edges, ...s.groups]) {
        if (taken.has(x.id)) fail(`Duplicate id "${x.id}"`);
      }
      const groupIds = new Set([...d.graph.groups.map((g) => g.id), ...s.groups.map((g) => g.id)]);
      const nodeIds = new Set([...d.graph.nodes.map((n) => n.id), ...s.nodes.map((n) => n.id)]);
      for (const n of s.nodes) {
        if (n.groupId !== undefined && !groupIds.has(n.groupId))
          fail(`Unknown group "${n.groupId}"`);
      }
      for (const g of s.groups) {
        if (g.parentId !== undefined && !groupIds.has(g.parentId))
          fail(`Unknown group "${g.parentId}"`);
      }
      for (const e of s.edges) {
        if (!nodeIds.has(e.source) || !nodeIds.has(e.target))
          fail(`Edge "${e.id}" has a missing end`);
      }
      d.graph.groups.push(...structuredClone(s.groups));
      d.graph.nodes.push(...structuredClone(s.nodes));
      d.graph.edges.push(...structuredClone(s.edges));
      Object.assign(d.layout.groupFrames, structuredClone(s.frames));
      return;
    }

    case 'batch': {
      for (const c of cmd.commands) applyCommand(d, c, ctx);
      return;
    }
  }
}
