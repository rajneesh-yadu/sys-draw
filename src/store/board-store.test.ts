import { beforeEach, describe, expect, it } from 'vitest';
import { GraphSchema, type IdKind } from '@/core';
import { registry } from '@/registry';
import { createBoardStore, PASTE_OFFSET, type BoardStore } from './board-store';
import { checkConnection, defaultProtocolStack, rankProtocols } from './connections';

/** Deterministic ids: node_1, edge_2, grp_3 … */
function counterIds() {
  let i = 0;
  return (kind: IdKind) =>
    `${{ node: 'node', edge: 'edge', group: 'grp' }[kind as 'node'] ?? kind}_${++i}`;
}

let store: BoardStore;
const s = () => store.getState();
const graph = () => s().doc.graph;
const node = (id: string) => graph().nodes.find((n) => n.id === id);
const ok = (r: { ok: boolean; reason?: string }) => expect(r).toEqual({ ok: true });

function add(defId: string, x = 0, y = 0, extra: { groupId?: string } = {}) {
  const before = new Set(graph().nodes.map((n) => n.id));
  ok(s().dispatch({ type: 'addNode', defId, position: { x, y }, ...extra }));
  return graph().nodes.find((n) => !before.has(n.id))!.id;
}

/** client → CDN → LB → 2 servers → DB (the F1 acceptance design). */
function buildF1() {
  const client = add('client.app', 0, 0);
  const cdn = add('network.cdn', 200, 0);
  const lb = add('network.load-balancer', 400, 0);
  const a = add('compute.app-server', 600, -80);
  const b = add('compute.app-server', 600, 80);
  const db = add('database.sql', 800, 0);
  for (const [src, tgt] of [
    [client, cdn],
    [cdn, lb],
    [lb, a],
    [lb, b],
    [a, db],
    [b, db],
  ] as const) {
    ok(s().dispatch({ type: 'connect', source: src, target: tgt }));
  }
  return { client, cdn, lb, a, b, db };
}

beforeEach(() => {
  store = createBoardStore({ registry, newId: counterIds() });
});

describe('addNode', () => {
  it('creates a node from the registry with defaults, first instance type and a numbered label', () => {
    const id = add('compute.app-server', 10, 20);
    const n = node(id)!;
    const def = registry.require('compute.app-server', 'component');
    expect(n).toMatchObject({
      defId: 'compute.app-server',
      label: 'app-server-1',
      position: { x: 10, y: 20 },
      scaling: { replicas: 1, instanceType: def.instanceTypes[0]!.id },
    });
    expect(n.config).toEqual(def.defaults);
    expect(node(add('compute.app-server'))!.label).toBe('app-server-2');
    expect(s().past.at(-1)!.label).toBe('Add app-server');
  });

  it('rejects unknown components and groups without changing state', () => {
    const r = s().dispatch({ type: 'addNode', defId: 'nope.thing', position: { x: 0, y: 0 } });
    expect(r).toEqual({ ok: false, reason: 'Unknown component "nope.thing"' });
    expect(s().lastError).toMatch(/Unknown component/);
    expect(
      s().dispatch({
        type: 'addNode',
        defId: 'client.app',
        position: { x: 0, y: 0 },
        groupId: 'grp_x',
      }).ok,
    ).toBe(false);
    expect(graph().nodes).toHaveLength(0);
    expect(s().past).toHaveLength(0);
  });
});

describe('connect', () => {
  it('builds the F1 design and the result is a valid Graph', () => {
    const ids = buildF1();
    expect(graph().nodes).toHaveLength(6);
    expect(graph().edges).toHaveLength(6);
    expect(GraphSchema.safeParse(graph()).success).toBe(true);
    const lbToA = graph().edges.find((e) => e.source === ids.lb && e.target === ids.a)!;
    expect(lbToA).toMatchObject({ sourcePortId: 'targets', targetPortId: 'in', sync: true });
    expect(lbToA.protocolStack).toEqual(['tcp', 'tls13', 'http2']);
    expect(graph().nodes.map((n) => n.label)).toEqual([
      'client-1',
      'cdn-1',
      'load-balancer-1',
      'app-server-1',
      'app-server-2',
      'sql-database-1',
    ]);
    const toDb = graph().edges.find((e) => e.target === ids.db)!;
    expect(toDb.protocolStack).toEqual(['postgres-wire']);
  });

  it('rejects incompatible ports, self loops and duplicates with a reason', () => {
    const client = add('client.app');
    const db = add('database.sql');
    const r = s().dispatch({ type: 'connect', source: client, target: db });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/No common protocol/);
    expect(s().dispatch({ type: 'connect', source: client, target: client }).ok).toBe(false);
    // DB has no output port.
    const srv = add('compute.app-server');
    expect(s().dispatch({ type: 'connect', source: db, target: srv })).toEqual({
      ok: false,
      reason: 'SQL Database has no output port',
    });
    ok(s().dispatch({ type: 'connect', source: srv, target: db }));
    expect(s().dispatch({ type: 'connect', source: srv, target: db }).ok).toBe(false);
    expect(graph().edges).toHaveLength(1);
  });

  it('honours an explicit protocol only when both ports share it', () => {
    const lb = add('network.load-balancer');
    const srv = add('compute.app-server');
    expect(s().dispatch({ type: 'connect', source: lb, target: srv, protocol: 'resp' }).ok).toBe(
      false,
    );
    ok(s().dispatch({ type: 'connect', source: lb, target: srv, protocol: 'grpc' }));
    expect(graph().edges[0]!.protocolStack).toEqual(['tcp', 'tls13', 'http2', 'grpc']);
  });

  it('marks edges into a queue as async', () => {
    const srv = add('compute.app-server');
    const q = add('messaging.queue');
    ok(s().dispatch({ type: 'connect', source: srv, target: q }));
    expect(graph().edges[0]!.sync).toBe(false);
  });
});

describe('connection helpers', () => {
  it('ranks higher-layer, multiplexed protocols first and keeps order otherwise', () => {
    expect(rankProtocols(registry, ['tcp', 'http1', 'http2'])).toEqual(['http2', 'http1', 'tcp']);
    expect(rankProtocols(registry, ['tcp', 'postgres-wire'])).toEqual(['postgres-wire', 'tcp']);
  });
  it('builds bottom-up stacks preferring encryption', () => {
    expect(defaultProtocolStack(registry, 'http1')).toEqual(['tcp', 'tls13', 'http1']);
    expect(defaultProtocolStack(registry, 'tcp')).toEqual(['tcp']);
    expect(defaultProtocolStack(registry, 'resp')).toEqual(['resp']);
  });
  it('checkConnection picks ports and reports a missing named port', () => {
    const lb = add('network.load-balancer');
    const srv = add('compute.app-server');
    const c = checkConnection(registry, graph(), { source: lb, target: srv });
    expect(c).toMatchObject({ ok: true, sourcePortId: 'targets', targetPortId: 'in' });
    expect(
      checkConnection(registry, graph(), { source: lb, target: srv, sourcePortId: 'in' }),
    ).toEqual({
      ok: false,
      reason: 'Load Balancer has no output port "in"',
    });
  });
});

describe('moveNodes / delete / updateConfig', () => {
  it('moves several nodes in one undoable step', () => {
    const a = add('client.app');
    const b = add('network.cdn');
    ok(
      s().dispatch({
        type: 'moveNodes',
        moves: [
          { id: a, position: { x: 5, y: 6 } },
          { id: b, position: { x: 7, y: 8 } },
        ],
      }),
    );
    expect(node(a)!.position).toEqual({ x: 5, y: 6 });
    s().undo();
    expect(node(a)!.position).toEqual({ x: 0, y: 0 });
    expect(node(b)!.position).toEqual({ x: 0, y: 0 });
  });

  it('deleting a node removes its edges; undo restores both', () => {
    const { lb } = buildF1();
    ok(s().dispatch({ type: 'delete', ids: [lb] }));
    expect(graph().nodes).toHaveLength(5);
    expect(graph().edges).toHaveLength(3);
    s().undo();
    expect(graph().nodes).toHaveLength(6);
    expect(graph().edges).toHaveLength(6);
  });

  it('deletes a single edge and refuses an empty delete', () => {
    buildF1();
    const e = graph().edges[0]!.id;
    ok(s().dispatch({ type: 'delete', ids: [e] }));
    expect(graph().edges).toHaveLength(5);
    expect(s().dispatch({ type: 'delete', ids: ['node_missing'] }).ok).toBe(false);
  });

  it('validates config against the component schema', () => {
    const lb = add('network.load-balancer');
    ok(
      s().dispatch({
        type: 'updateConfig',
        nodeId: lb,
        config: { algorithm: 'least-connections' },
      }),
    );
    expect(node(lb)!.config.algorithm).toBe('least-connections');
    expect(node(lb)!.config.layer).toBe('L7');
    const r = s().dispatch({ type: 'updateConfig', nodeId: lb, config: { algorithm: 'magic' } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/Invalid config for load-balancer-1: algorithm/);
    expect(node(lb)!.config.algorithm).toBe('least-connections');
  });
});

describe('groups', () => {
  it('groups nodes, nests groups, and moving a group moves its contents', () => {
    const a = add('compute.app-server', 100, 100);
    const b = add('compute.app-server', 100, 200);
    ok(
      s().dispatch({
        type: 'group',
        kind: 'subnet',
        memberIds: [a, b],
        frame: { x: 80, y: 80, width: 300, height: 300 },
      }),
    );
    const subnet = graph().groups[0]!;
    expect(subnet).toMatchObject({ kind: 'subnet', label: 'Subnet 1' });
    expect(node(a)!.groupId).toBe(subnet.id);
    ok(s().dispatch({ type: 'group', kind: 'vpc', memberIds: [subnet.id] }));
    const vpc = graph().groups[1]!;
    expect(graph().groups[0]!.parentId).toBe(vpc.id);
    expect(GraphSchema.safeParse(graph()).success).toBe(true);

    ok(s().dispatch({ type: 'moveGroup', groupId: vpc.id, dx: 10, dy: -5 }));
    expect(node(a)!.position).toEqual({ x: 110, y: 95 });
    expect(s().doc.layout.groupFrames[subnet.id]).toEqual({
      x: 90,
      y: 75,
      width: 300,
      height: 300,
    });
    expect(
      s().dispatch({ type: 'moveGroup', groupId: vpc.id, dx: 0, dy: 0, parentId: subnet.id }).ok,
    ).toBe(false);
  });

  it('a new group inherits the common parent of its members', () => {
    ok(s().dispatch({ type: 'group', kind: 'region', memberIds: [] }));
    const region = graph().groups[0]!.id;
    const a = add('compute.app-server', 0, 0, { groupId: region });
    ok(s().dispatch({ type: 'group', kind: 'az', memberIds: [a] }));
    expect(graph().groups[1]!.parentId).toBe(region);
  });

  it('dropping a node into a group sets groupId; null moves it out', () => {
    ok(s().dispatch({ type: 'group', kind: 'vpc', memberIds: [] }));
    const vpc = graph().groups[0]!.id;
    const a = add('client.app');
    ok(
      s().dispatch({
        type: 'moveNodes',
        moves: [{ id: a, position: { x: 1, y: 1 }, groupId: vpc }],
      }),
    );
    expect(node(a)!.groupId).toBe(vpc);
    ok(
      s().dispatch({
        type: 'moveNodes',
        moves: [{ id: a, position: { x: 1, y: 1 }, groupId: null }],
      }),
    );
    expect(node(a)!.groupId).toBeUndefined();
  });

  it('ungroup lifts members to the parent; deleting a group deletes its contents', () => {
    ok(s().dispatch({ type: 'group', kind: 'region', memberIds: [] }));
    const region = graph().groups[0]!.id;
    const a = add('compute.app-server', 0, 0, { groupId: region });
    ok(s().dispatch({ type: 'group', kind: 'az', memberIds: [a] }));
    const az = graph().groups[1]!.id;
    ok(s().dispatch({ type: 'ungroup', groupId: az }));
    expect(node(a)!.groupId).toBe(region);
    expect(graph().groups).toHaveLength(1);

    ok(s().dispatch({ type: 'delete', ids: [region] }));
    expect(graph().groups).toHaveLength(0);
    expect(graph().nodes).toHaveLength(0);
    s().undo();
    expect(node(a)!.groupId).toBe(region);
  });
});

describe('undo / redo', () => {
  it('undoes 20 steps back to empty and redoes them all', () => {
    buildF1(); // 12 commands
    const n = graph().nodes[0]!.id;
    for (let i = 1; i <= 8; i++) {
      ok(s().dispatch({ type: 'moveNodes', moves: [{ id: n, position: { x: i, y: i } }] }));
    }
    expect(s().past).toHaveLength(20);
    const full = structuredClone(graph());
    for (let i = 0; i < 20; i++) expect(s().undo()).toBe(true);
    expect(graph()).toEqual({ nodes: [], edges: [], groups: [] });
    expect(s().undo()).toBe(false);
    for (let i = 0; i < 20; i++) expect(s().redo()).toBe(true);
    expect(s().redo()).toBe(false);
    expect(graph()).toEqual(full);
  });

  it('a new command clears the redo stack; failed commands do not touch history', () => {
    add('client.app');
    add('client.app');
    s().undo();
    expect(s().future).toHaveLength(1);
    s().dispatch({ type: 'addNode', defId: 'bad.id', position: { x: 0, y: 0 } });
    expect(s().future).toHaveLength(1);
    add('network.cdn');
    expect(s().future).toHaveLength(0);
  });

  it('caps history and drops undone ids from the selection', () => {
    store = createBoardStore({ registry, newId: counterIds(), historyLimit: 3 });
    for (let i = 0; i < 5; i++) add('client.app');
    expect(s().past).toHaveLength(3);
    const last = graph().nodes.at(-1)!.id;
    s().setSelection([last]);
    s().undo();
    expect(s().selection).toEqual([]);
  });

  it('batch is a single history entry', () => {
    ok(
      s().dispatch({
        type: 'batch',
        label: 'Auto-layout',
        commands: [
          { type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 } },
          { type: 'addNode', defId: 'network.cdn', position: { x: 0, y: 0 } },
        ],
      }),
    );
    expect(s().past.map((h) => h.label)).toEqual(['Auto-layout']);
    s().undo();
    expect(graph().nodes).toHaveLength(0);
  });

  it('a batch that fails part-way changes nothing', () => {
    const r = s().dispatch({
      type: 'batch',
      label: 'x',
      commands: [
        { type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 } },
        { type: 'addNode', defId: 'nope', position: { x: 0, y: 0 } },
      ],
    });
    expect(r.ok).toBe(false);
    expect(graph().nodes).toHaveLength(0);
  });
});

describe('copy / paste / cut', () => {
  it('pastes selected nodes, internal edges and groups with fresh ids and offset', () => {
    const { lb, a, b } = buildF1();
    ok(
      s().dispatch({
        type: 'group',
        kind: 'subnet',
        memberIds: [a, b],
        frame: { x: 0, y: 0, width: 10, height: 10 },
      }),
    );
    const subnet = graph().groups[0]!.id;
    s().setSelection([lb, subnet]);
    expect(s().copy()).toBe(4); // lb, subnet + its 2 servers
    ok(s().paste());
    expect(graph().nodes).toHaveLength(9);
    expect(graph().groups).toHaveLength(2);
    // lb→a and lb→b are internal to the copy; edges to client/db are not.
    expect(graph().edges).toHaveLength(8);
    expect(GraphSchema.safeParse(graph()).success).toBe(true);
    const pastedLb = graph().nodes.find((n) => n.label === 'load-balancer-2')!;
    expect(pastedLb.position).toEqual({ x: 400 + PASTE_OFFSET, y: PASTE_OFFSET });
    expect(s().selection).toContain(pastedLb.id);
    const newGroup = graph().groups[1]!.id;
    expect(s().doc.layout.groupFrames[newGroup]).toEqual({
      x: PASTE_OFFSET,
      y: PASTE_OFFSET,
      width: 10,
      height: 10,
    });
    // A second paste offsets further and is undone in one step.
    ok(s().paste());
    expect(graph().nodes).toHaveLength(12);
    s().undo();
    expect(graph().nodes).toHaveLength(9);
  });

  it('cut removes the selection; paste brings it back; empty clipboard fails', () => {
    expect(s().paste().ok).toBe(false);
    const a = add('client.app');
    s().setSelection([a]);
    ok(s().cut());
    expect(graph().nodes).toHaveLength(0);
    ok(s().paste());
    expect(graph().nodes[0]!.label).toBe('client-1');
  });

  it('copy drops parent links outside the selection', () => {
    ok(s().dispatch({ type: 'group', kind: 'vpc', memberIds: [] }));
    const vpc = graph().groups[0]!.id;
    const a = add('client.app', 0, 0, { groupId: vpc });
    s().copy([a]);
    ok(s().paste());
    expect(graph().nodes[1]!.groupId).toBeUndefined();
  });
});

describe('load', () => {
  it('replaces the board and clears history', () => {
    add('client.app');
    s().load({ graph: { nodes: [], edges: [], groups: [] }, providerId: 'aws' });
    expect(s().doc.providerId).toBe('aws');
    expect(s().past).toHaveLength(0);
  });
});
