/**
 * The command bus vocabulary. Every board edit is one of these plain-data commands; the store
 * applies it to an Immer draft and records the patches + inverse patches for undo/redo.
 */
import { current, type Draft } from 'immer';
import {
  EdgeConfigSchema,
  GROUP_KINDS,
  GraphSchema,
  GroupSchema,
  NodeScalingSchema,
  NonEmptyStringSchema,
  ScenarioSchema,
  safeParseReadable,
  type Autoscale,
  type EdgeConfig,
  type EdgeInstance,
  type Graph,
  type Group,
  type GroupKind,
  type IdKind,
  type NodeInstance,
  type Position,
  type ProviderId,
  type Scenario,
} from '@/core';
import { mapRegion, type Registry } from '@/registry';
import { checkConnection, checkProtocolStack, defaultProtocolStack } from './connections';
import { descendantsOf, labelBase, labelBaseFromName, nextLabel } from './graph-utils';
import type { BoardDoc, Rect, Subgraph } from './types';

export interface NodeMove {
  id: string;
  position: Position;
  /** New parent group; `null` moves the node out of any group; omit to keep it. */
  groupId?: string | null;
}

/** Scaling fields to change; `autoscale: null` turns autoscaling off. */
export interface NodeScalingPatch {
  replicas?: number;
  instanceType?: string;
  autoscale?: Autoscale | null;
}

/** Edge config fields to change; `null` removes a field (back to the engine default). */
export type EdgeConfigPatch = { [K in keyof EdgeConfig]?: EdgeConfig[K] | null };

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
  /** Rename a node and/or change its scaling (validated; instance type must be the component's). */
  | { type: 'updateNode'; nodeId: string; label?: string; scaling?: NodeScalingPatch }
  /** Change an edge's protocol stack (checked against ports + runsOn), sync flag or config. */
  | {
      type: 'updateEdge';
      edgeId: string;
      protocolStack?: string[];
      sync?: boolean;
      config?: EdgeConfigPatch;
    }
  /** Rename/re-kind a group, set its region, or its security settings (`null` clears). */
  | {
      type: 'updateGroup';
      groupId: string;
      label?: string;
      kind?: GroupKind;
      regionId?: string | null;
      security?: NonNullable<Group['security']> | null;
    }
  /** Shallow-merge top-level scenario fields; the result must satisfy ScenarioSchema. */
  | { type: 'updateScenario'; patch: Partial<Scenario> }
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
  | { type: 'batch'; label: string; commands: BoardCommand[] }
  /** Replace the whole graph (snapshot restore). Undoable like any other command. */
  | { type: 'replaceGraph'; graph: Graph; label?: string }
  /**
   * Switch the board's cloud provider (S12). Names, icons, prices and limits follow from
   * `providerId`; this also moves Region groups and region chaos events to the same metro on the
   * new provider (nearest region when it has none there; see registry `mapRegion`).
   */
  | { type: 'setProvider'; providerId: ProviderId };

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
    case 'updateNode':
      return cmd.scaling === undefined ? 'Rename node' : 'Change scaling';
    case 'updateEdge':
      return cmd.protocolStack !== undefined ? 'Change protocol' : 'Change connection';
    case 'updateGroup':
      return cmd.label !== undefined && Object.keys(cmd).length === 3
        ? 'Rename group'
        : 'Change group';
    case 'updateScenario':
      return 'Change scenario';
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
    case 'replaceGraph':
      return cmd.label ?? 'Replace board';
    case 'setProvider':
      return `Switch provider to ${cmd.providerId}`;
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
      pruneScenario(d);
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

    case 'updateNode': {
      const n = findNode(d, cmd.nodeId) ?? fail(`Unknown node "${cmd.nodeId}"`);
      if (cmd.label !== undefined) {
        const res = safeParseReadable(NonEmptyStringSchema, cmd.label);
        if (!res.ok) fail(`Invalid label: ${res.errors.join('; ')}`);
        n.label = cmd.label.trim();
      }
      if (cmd.scaling !== undefined) {
        const { autoscale, ...rest } = cmd.scaling;
        const merged: Record<string, unknown> = { ...current(n.scaling), ...rest };
        if (autoscale === null) delete merged.autoscale;
        else if (autoscale !== undefined) merged.autoscale = autoscale;
        const res = safeParseReadable(NodeScalingSchema, merged);
        if (!res.ok) fail(`Invalid scaling for ${n.label}: ${res.errors.join('; ')}`);
        const def = ctx.registry.get(n.defId, 'component');
        const instanceType = merged.instanceType as string;
        if (def && !def.instanceTypes.some((t) => t.id === instanceType)) {
          fail(`${def.name} has no instance type "${instanceType}"`);
        }
        n.scaling = merged as NodeInstance['scaling'];
      }
      return;
    }

    case 'updateEdge': {
      const e =
        d.graph.edges.find((x) => x.id === cmd.edgeId) ?? fail(`Unknown edge "${cmd.edgeId}"`);
      if (cmd.protocolStack !== undefined) {
        const reason = checkProtocolStack(
          ctx.registry,
          d.graph as BoardDoc['graph'],
          e as EdgeInstance,
          cmd.protocolStack,
        );
        if (reason !== null) fail(reason);
        e.protocolStack = [...cmd.protocolStack];
      }
      if (cmd.sync !== undefined) e.sync = cmd.sync;
      if (cmd.config !== undefined) {
        const merged: Record<string, unknown> = { ...e.config };
        for (const [k, v] of Object.entries(cmd.config)) {
          if (v === null || v === undefined) delete merged[k];
          else merged[k] = v;
        }
        const res = safeParseReadable(EdgeConfigSchema.strict(), merged);
        if (!res.ok) fail(`Invalid connection settings: ${res.errors.join('; ')}`);
        e.config = merged as EdgeConfig;
      }
      return;
    }

    case 'updateGroup': {
      const g = requireGroup(d, cmd.groupId);
      const next: Record<string, unknown> = { ...current(g) };
      if (cmd.label !== undefined) next.label = cmd.label.trim();
      if (cmd.kind !== undefined) next.kind = cmd.kind;
      if (cmd.regionId === null) delete next.regionId;
      else if (cmd.regionId !== undefined) next.regionId = cmd.regionId;
      if (cmd.security === null) delete next.security;
      else if (cmd.security !== undefined) next.security = cmd.security;
      const res = safeParseReadable(GroupSchema, next);
      if (!res.ok) return fail(`Invalid group: ${res.errors.join('; ')}`);
      d.graph.groups[d.graph.groups.indexOf(g)] = res.value as Group;
      return;
    }

    case 'updateScenario': {
      const merged = { ...current(d.scenario), ...cmd.patch };
      const res = safeParseReadable(ScenarioSchema, merged);
      if (!res.ok) return fail(`Invalid scenario: ${res.errors.join('; ')}`);
      d.scenario = res.value as Scenario;
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

    case 'replaceGraph': {
      const res = safeParseReadable(GraphSchema, cmd.graph);
      if (!res.ok) fail(`Invalid graph: ${res.errors[0] ?? 'unknown error'}`);
      d.graph = structuredClone(cmd.graph) as Draft<Graph>;
      const groupIds = new Set(cmd.graph.groups.map((g) => g.id));
      for (const id of Object.keys(d.layout.groupFrames)) {
        if (!groupIds.has(id)) delete d.layout.groupFrames[id];
      }
      pruneScenario(d);
      return;
    }

    case 'setProvider': {
      const to =
        ctx.registry.get(cmd.providerId, 'provider') ??
        fail(`Unknown provider "${cmd.providerId}"`);
      if (d.providerId === cmd.providerId) return;
      const from = ctx.registry.get(d.providerId, 'provider');
      const generic = ctx.registry.get('generic', 'provider');
      const map = (id: string) => mapRegion(from, to, id, generic)?.id ?? id;
      for (const g of d.graph.groups) if (g.regionId !== undefined) g.regionId = map(g.regionId);
      for (const e of d.scenario.events) {
        if (e.kind === 'regionOutage') e.regionId = map(e.regionId);
        if (e.kind === 'networkPartition') {
          e.regionA = map(e.regionA);
          e.regionB = map(e.regionB);
        }
      }
      d.providerId = cmd.providerId;
      return;
    }
  }
}

/**
 * Drop flow steps and chaos events that point at nodes, edges or groups no longer on the board,
 * so a saved board always passes core's BoardSchema reference checks.
 */
function pruneScenario(d: D): void {
  const nodeIds = new Set(d.graph.nodes.map((n) => n.id));
  const edgeIds = new Set(d.graph.edges.map((e) => e.id));
  const groupIds = new Set(d.graph.groups.map((g) => g.id));
  for (const f of d.scenario.flows) {
    if (f.path.some((s) => !nodeIds.has(s.nodeId))) {
      f.path = f.path.filter((s) => nodeIds.has(s.nodeId));
    }
  }
  const live = (ev: (typeof d.scenario.events)[number]) =>
    !(
      ('nodeId' in ev && ev.nodeId !== undefined && !nodeIds.has(ev.nodeId)) ||
      ('edgeId' in ev && ev.edgeId !== undefined && !edgeIds.has(ev.edgeId)) ||
      ('groupId' in ev && ev.groupId !== undefined && !groupIds.has(ev.groupId))
    );
  if (!d.scenario.events.every(live)) d.scenario.events = d.scenario.events.filter(live);
}
