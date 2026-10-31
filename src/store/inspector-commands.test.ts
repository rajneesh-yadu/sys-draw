import { beforeEach, describe, expect, it } from 'vitest';
import { ScenarioSchema, type IdKind } from '@/core';
import { registry } from '@/registry';
import { createBoardStore, type BoardStore } from './board-store';
import { checkProtocolStack, edgeProtocolStackOptions, protocolStackOptions } from './connections';
import { defaultScenario, emptyBoardDoc } from './types';

function counterIds() {
  let i = 0;
  return (kind: IdKind) =>
    `${{ node: 'node', edge: 'edge', group: 'grp' }[kind as 'node'] ?? kind}_${++i}`;
}

let store: BoardStore;
const s = () => store.getState();
const graph = () => s().doc.graph;

beforeEach(() => {
  store = createBoardStore({ registry, newId: counterIds() });
});

function setup() {
  s().dispatch({ type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 } });
  s().dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x: 200, y: 0 } });
  s().dispatch({ type: 'addNode', defId: 'database.sql', position: { x: 400, y: 0 } });
  s().dispatch({ type: 'connect', source: 'node_1', target: 'node_2' });
  s().dispatch({ type: 'group', kind: 'vpc', memberIds: ['node_2'] });
  return { client: 'node_1', app: 'node_2', db: 'node_3', edge: 'edge_4', group: 'grp_5' };
}

describe('default scenario', () => {
  it('is valid and part of an empty board', () => {
    expect(ScenarioSchema.safeParse(defaultScenario()).success).toBe(true);
    expect(emptyBoardDoc().scenario).toEqual(defaultScenario());
    expect(s().doc.scenario).toEqual(defaultScenario());
  });
});

describe('updateNode', () => {
  it('renames and changes scaling as one undoable step each', () => {
    const { app } = setup();
    const before = s().past.length;
    expect(s().dispatch({ type: 'updateNode', nodeId: app, label: '  api  ' })).toEqual({
      ok: true,
    });
    expect(s().dispatch({ type: 'updateNode', nodeId: app, scaling: { replicas: 4 } }).ok).toBe(
      true,
    );
    const n = () => graph().nodes.find((x) => x.id === app)!;
    expect(n().label).toBe('api');
    expect(n().scaling.replicas).toBe(4);
    expect(s().past.length).toBe(before + 2);
    expect(s().past.at(-1)!.label).toBe('Change scaling');
    s().undo();
    expect(n().scaling.replicas).toBe(1);
    expect(n().label).toBe('api');
  });

  it('adds and removes autoscaling', () => {
    const { app } = setup();
    const autoscale = { min: 2, max: 8, targetUtil: 0.6, warmupSec: 60 };
    s().dispatch({ type: 'updateNode', nodeId: app, scaling: { autoscale } });
    expect(graph().nodes[1]!.scaling.autoscale).toEqual(autoscale);
    s().dispatch({ type: 'updateNode', nodeId: app, scaling: { autoscale: null } });
    expect(graph().nodes[1]!.scaling).not.toHaveProperty('autoscale');
  });

  it('blocks invalid values with a reason and leaves state unchanged', () => {
    const { app } = setup();
    const before = structuredClone(s().doc);
    const r1 = s().dispatch({ type: 'updateNode', nodeId: app, scaling: { replicas: 0 } });
    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.reason).toMatch(/replicas/);
    const r2 = s().dispatch({ type: 'updateNode', nodeId: app, scaling: { instanceType: 'huge' } });
    expect(!r2.ok && r2.reason).toBe('App Server has no instance type "huge"');
    const r3 = s().dispatch({
      type: 'updateNode',
      nodeId: app,
      scaling: { autoscale: { min: 5, max: 2, targetUtil: 0.5, warmupSec: 0 } },
    });
    expect(!r3.ok && r3.reason).toMatch(/max must be ≥ min/);
    expect(s().dispatch({ type: 'updateNode', nodeId: app, label: '   ' }).ok).toBe(false);
    expect(s().doc).toEqual(before);
  });
});

describe('updateEdge', () => {
  it('changes sync, timeout and retries; null clears a field', () => {
    const { edge } = setup();
    s().dispatch({ type: 'updateEdge', edgeId: edge, sync: false });
    s().dispatch({ type: 'updateEdge', edgeId: edge, config: { timeoutMs: 500, retries: 2 } });
    const e = () => graph().edges[0]!;
    expect(e()).toMatchObject({ sync: false, config: { timeoutMs: 500, retries: 2 } });
    s().dispatch({ type: 'updateEdge', edgeId: edge, config: { retries: null } });
    expect(e().config).toEqual({ timeoutMs: 500 });
    s().undo();
    expect(e().config).toEqual({ timeoutMs: 500, retries: 2 });
  });

  it('rejects invalid config and unknown keys', () => {
    const { edge } = setup();
    expect(s().dispatch({ type: 'updateEdge', edgeId: edge, config: { retries: -1 } }).ok).toBe(
      false,
    );
    expect(s().dispatch({ type: 'updateEdge', edgeId: edge, config: { timeoutMs: 0 } }).ok).toBe(
      false,
    );
    expect(graph().edges[0]!.config).toEqual({});
  });

  it('switches protocol stacks only to ones valid for the ports and runsOn', () => {
    const { edge } = setup();
    expect(graph().edges[0]!.protocolStack).toEqual(['tcp', 'tls13', 'http2']);
    expect(
      s().dispatch({ type: 'updateEdge', edgeId: edge, protocolStack: ['tcp', 'tls13', 'grpc'] }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/gRPC cannot run on TLS 1.3/) });
    expect(
      s().dispatch({ type: 'updateEdge', edgeId: edge, protocolStack: ['tcp', 'http1'] }).ok,
    ).toBe(true);
    expect(graph().edges[0]!.protocolStack).toEqual(['tcp', 'http1']);
    expect(s().past.at(-1)!.label).toBe('Change protocol');
  });
});

describe('protocol stack helpers', () => {
  it('enumerates stacks by runsOn, encrypted first', () => {
    expect(protocolStackOptions(registry, 'http2')).toEqual([
      ['tcp', 'tls13', 'http2'],
      ['tcp', 'http2'],
    ]);
    expect(protocolStackOptions(registry, 'grpc')).toEqual([
      ['tcp', 'tls13', 'http2', 'grpc'],
      ['tcp', 'http2', 'grpc'],
    ]);
    expect(protocolStackOptions(registry, 'postgres-wire')).toEqual([['postgres-wire']]);
  });

  it('lists every option for an edge and each passes checkProtocolStack', () => {
    const { edge } = setup();
    const e = graph().edges.find((x) => x.id === edge)!;
    const options = edgeProtocolStackOptions(registry, graph(), e);
    expect(options.length).toBeGreaterThan(2);
    for (const stack of options) expect(checkProtocolStack(registry, graph(), e, stack)).toBeNull();
    expect(checkProtocolStack(registry, graph(), e, ['http2'])).toMatch(/must run on/);
    expect(checkProtocolStack(registry, graph(), e, [])).toMatch(/at least one/);
    expect(checkProtocolStack(registry, graph(), e, ['tcp'])).toMatch(/not spoken by both ends/);
  });
});

describe('updateGroup', () => {
  it('renames, sets region and security, and validates', () => {
    const { group } = setup();
    s().dispatch({ type: 'updateGroup', groupId: group, label: 'Prod VPC' });
    expect(s().past.at(-1)!.label).toBe('Rename group');
    s().dispatch({
      type: 'updateGroup',
      groupId: group,
      regionId: 'us-east',
      security: {
        public: false,
        firewallRules: [
          {
            direction: 'ingress',
            action: 'allow',
            protocol: 'tcp',
            fromPort: 443,
            toPort: 443,
            peer: 'internet',
          },
        ],
      },
    });
    const g = () => graph().groups[0]!;
    expect(g()).toMatchObject({
      label: 'Prod VPC',
      regionId: 'us-east',
      security: { public: false },
    });
    const bad = s().dispatch({
      type: 'updateGroup',
      groupId: group,
      security: {
        public: true,
        firewallRules: [
          {
            direction: 'ingress',
            action: 'allow',
            protocol: 'tcp',
            fromPort: 443,
            toPort: 80,
            peer: 'x',
          },
        ],
      },
    });
    expect(!bad.ok && bad.reason).toMatch(/toPort must be ≥ fromPort/);
    expect(s().dispatch({ type: 'updateGroup', groupId: group, regionId: 'US East' }).ok).toBe(
      false,
    );
    s().dispatch({ type: 'updateGroup', groupId: group, regionId: null });
    expect(g()).not.toHaveProperty('regionId');
  });
});

describe('updateScenario', () => {
  it('merges and validates, one undo step', () => {
    s().dispatch({ type: 'updateScenario', patch: { peakMultiplier: 5, diurnal: false } });
    expect(s().doc.scenario).toMatchObject({ peakMultiplier: 5, diurnal: false });
    const bad = s().dispatch({ type: 'updateScenario', patch: { peakMultiplier: 0 } });
    expect(!bad.ok && bad.reason).toMatch(/peakMultiplier/);
    s().undo();
    expect(s().doc.scenario).toEqual(defaultScenario());
  });

  it('is restored by load() defaults', () => {
    s().dispatch({ type: 'updateScenario', patch: { seed: 9 } });
    s().load({ graph: { nodes: [], edges: [], groups: [] } });
    expect(s().doc.scenario).toEqual(defaultScenario());
  });
});
