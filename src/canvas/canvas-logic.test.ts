import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { createBoardStore, emptyBoardDoc, type BoardDoc, type Graph } from '@/store';
import { decodePaletteItem, encodePaletteItem } from './dnd';
import {
  computeGroupRects,
  findDropGroup,
  GROUP_HEADER,
  GROUP_PADDING,
  NODE_HEIGHT,
  NODE_WIDTH,
  snap,
} from './geometry';
import { computeAutoLayout, toElkGraph } from './layout';
import { paletteSections } from './palette-model';
import { shortcutFor } from './shortcuts';
import { toFlowEdges, toFlowNodes } from './to-flow';

const node = (id: string, x: number, y: number, groupId?: string) => ({
  id,
  defId: 'compute.app-server',
  label: id,
  position: { x, y },
  ...(groupId ? { groupId } : {}),
  config: {},
  scaling: { replicas: 1, instanceType: 'small' },
});

/** region ⊃ vpc ⊃ node_a; node_b at top level. */
const nested: Graph = {
  groups: [
    { id: 'grp_vpc', kind: 'vpc', label: 'VPC 1', parentId: 'grp_region' },
    { id: 'grp_region', kind: 'region', label: 'Region 1' },
  ],
  nodes: [node('node_a', 100, 100, 'grp_vpc'), node('node_b', 1000, 0)],
  edges: [],
};

describe('geometry', () => {
  it('fits groups around their contents, deepest first', () => {
    const rects = computeGroupRects(nested, {});
    const vpc = rects.get('grp_vpc')!;
    expect(vpc).toEqual({
      x: 100 - GROUP_PADDING,
      y: 100 - GROUP_PADDING - GROUP_HEADER,
      width: NODE_WIDTH + 2 * GROUP_PADDING,
      height: NODE_HEIGHT + 2 * GROUP_PADDING + GROUP_HEADER,
    });
    const region = rects.get('grp_region')!;
    expect(region.x).toBe(vpc.x - GROUP_PADDING);
    expect(region.width).toBe(vpc.width + 2 * GROUP_PADDING);
  });

  it('a stored frame is kept but grows to fit contents; empty groups get a default size', () => {
    const rects = computeGroupRects(nested, { grp_vpc: { x: 0, y: 0, width: 50, height: 50 } });
    const vpc = rects.get('grp_vpc')!;
    expect(vpc.x).toBe(0);
    expect(vpc.x + vpc.width).toBe(100 + NODE_WIDTH + GROUP_PADDING);
    const empty = computeGroupRects(
      { nodes: [], edges: [], groups: [{ id: 'grp_e', kind: 'az', label: 'AZ' }] },
      {},
    );
    expect(empty.get('grp_e')).toEqual({ x: 0, y: 0, width: 480, height: 320 });
  });

  it('finds the innermost group under a point, honouring exclusions', () => {
    const rects = computeGroupRects(nested, {});
    expect(findDropGroup(nested, rects, { x: 150, y: 120 })).toBe('grp_vpc');
    expect(findDropGroup(nested, rects, { x: 150, y: 120 }, new Set(['grp_vpc']))).toBe(
      'grp_region',
    );
    expect(findDropGroup(nested, rects, { x: 2000, y: 2000 })).toBeUndefined();
  });

  it('snaps to the grid', () => {
    expect(snap(23)).toBe(16);
    expect(snap(25)).toBe(32);
  });
});

describe('toFlowNodes / toFlowEdges', () => {
  const doc: BoardDoc = { ...emptyBoardDoc('aws'), graph: nested };
  const rects = computeGroupRects(nested, {});

  it('puts parents before children with parent-relative positions', () => {
    const nodes = toFlowNodes(doc, rects, new Set(['node_a']), registry);
    expect(nodes.map((n) => n.id)).toEqual(['grp_region', 'grp_vpc', 'node_a', 'node_b']);
    const vpc = rects.get('grp_vpc')!;
    const a = nodes.find((n) => n.id === 'node_a')!;
    expect(a.parentId).toBe('grp_vpc');
    expect(a.position).toEqual({ x: 100 - vpc.x, y: 100 - vpc.y });
    expect(a.selected).toBe(true);
    expect(a.data).toMatchObject({ label: 'node_a', icon: 'server', replicas: 1, known: true });
    expect(nodes.find((n) => n.id === 'node_b')!.parentId).toBeUndefined();
  });

  it('labels nodes with the provider product name', () => {
    const lb = toFlowNodes(
      {
        ...doc,
        graph: { ...nested, nodes: [{ ...node('node_lb', 0, 0), defId: 'network.load-balancer' }] },
      },
      rects,
      new Set(),
      registry,
    ).find((n) => n.id === 'node_lb')!;
    expect(lb.data.name).toBe('Elastic Load Balancing (ALB)');
  });

  it('labels edges with the top protocol and animates async ones', () => {
    const store = createBoardStore({ registry });
    const s = store.getState();
    s.dispatch({
      type: 'addNode',
      defId: 'compute.app-server',
      position: { x: 0, y: 0 },
      id: 'node_s',
    });
    s.dispatch({
      type: 'addNode',
      defId: 'messaging.queue',
      position: { x: 0, y: 0 },
      id: 'node_q',
    });
    s.dispatch({
      type: 'addNode',
      defId: 'network.load-balancer',
      position: { x: 0, y: 0 },
      id: 'node_l',
    });
    s.dispatch({ type: 'connect', source: 'node_s', target: 'node_q', id: 'edge_1' });
    s.dispatch({ type: 'connect', source: 'node_l', target: 'node_s', id: 'edge_2' });
    const edges = toFlowEdges(store.getState().doc, new Set(), registry);
    expect(edges.find((e) => e.id === 'edge_1')).toMatchObject({
      animated: true,
      targetHandle: 'producers',
    });
    expect(edges.find((e) => e.id === 'edge_2')).toMatchObject({
      label: 'HTTP/2',
      animated: false,
    });
  });
});

describe('auto-layout (ELK)', () => {
  it('builds a compound ELK graph', () => {
    const elk = toElkGraph(nested, computeGroupRects(nested, {}));
    expect(elk.children!.map((c) => c.id)).toEqual(['grp_region', 'node_b']);
    expect(elk.children![0]!.children![0]!.children![0]!.id).toBe('node_a');
  });

  it('lays a chain out left to right as one command, with groups fitting their nodes', async () => {
    const store = createBoardStore({ registry });
    const s = store.getState();
    const ids = ['client.app', 'network.cdn', 'network.load-balancer', 'compute.app-server'].map(
      (defId, i) => {
        const id = `node_${i}`;
        s.dispatch({ type: 'addNode', defId, position: { x: 0, y: 0 }, id });
        return id;
      },
    );
    for (let i = 0; i < 3; i++)
      s.dispatch({ type: 'connect', source: ids[i]!, target: ids[i + 1]! });
    s.dispatch({ type: 'group', kind: 'vpc', memberIds: ['node_2', 'node_3'], id: 'grp_v' });
    const before = store.getState().past.length;
    const g = store.getState().doc;
    const cmd = await computeAutoLayout(g.graph, computeGroupRects(g.graph, g.layout.groupFrames));
    expect(s.dispatch(cmd)).toEqual({ ok: true });
    expect(store.getState().past.length).toBe(before + 1);
    const pos = store.getState().doc.graph.nodes.map((n) => n.position.x);
    for (let i = 1; i < pos.length; i++) expect(pos[i]!).toBeGreaterThan(pos[i - 1]!);
    const frame = store.getState().doc.layout.groupFrames.grp_v!;
    const inner = store.getState().doc.graph.nodes.find((n) => n.id === 'node_3')!.position;
    expect(inner.x).toBeGreaterThanOrEqual(frame.x);
    expect(inner.x + NODE_WIDTH).toBeLessThanOrEqual(frame.x + frame.width);
  });
});

describe('shortcuts', () => {
  const k = (
    key: string,
    m: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {},
  ) =>
    shortcutFor({
      key,
      ctrlKey: !!m.ctrl,
      metaKey: !!m.meta,
      shiftKey: !!m.shift,
      altKey: !!m.alt,
    });
  it('maps the standard editing keys', () => {
    expect(k('z', { ctrl: true })).toBe('undo');
    expect(k('z', { meta: true })).toBe('undo');
    expect(k('Z', { ctrl: true, shift: true })).toBe('redo');
    expect(k('y', { ctrl: true })).toBe('redo');
    expect(k('c', { ctrl: true })).toBe('copy');
    expect(k('v', { meta: true })).toBe('paste');
    expect(k('x', { ctrl: true })).toBe('cut');
    expect(k('a', { ctrl: true })).toBe('selectAll');
    expect(k('g', { ctrl: true })).toBe('group');
    expect(k('G', { ctrl: true, shift: true })).toBe('ungroup');
    expect(k('Delete')).toBe('delete');
    expect(k('Backspace')).toBe('delete');
    expect(k('Escape')).toBe('clearSelection');
  });
  it('ignores plain letters and Alt combos', () => {
    expect(k('z')).toBeNull();
    expect(k('z', { ctrl: true, alt: true })).toBeNull();
    expect(k('c', { ctrl: true, shift: true })).toBeNull();
  });
});

describe('palette model and drag payload', () => {
  it('groups registry components by category and searches names, tags and provider names', () => {
    const all = paletteSections(registry, 'generic', '');
    expect(all[0]!.category).toBe('clients');
    expect(all.flatMap((s) => s.items).length).toBe(registry.list({ kind: 'component' }).length);
    const hits = paletteSections(registry, 'aws', 'elastic load');
    expect(hits.flatMap((s) => s.items.map((i) => i.def.id))).toEqual(['network.load-balancer']);
    expect(paletteSections(registry, 'generic', 'zzz-nothing')).toEqual([]);
  });
  it('round-trips palette items and rejects junk', () => {
    expect(
      decodePaletteItem(encodePaletteItem({ kind: 'component', defId: 'cache.in-memory' })),
    ).toEqual({
      kind: 'component',
      defId: 'cache.in-memory',
    });
    expect(decodePaletteItem(encodePaletteItem({ kind: 'group', groupKind: 'vpc' }))).toEqual({
      kind: 'group',
      groupKind: 'vpc',
    });
    expect(decodePaletteItem('not json')).toBeNull();
    expect(decodePaletteItem('{"kind":"x"}')).toBeNull();
  });
});
