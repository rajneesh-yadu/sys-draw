/**
 * S16 done-when, end to end through the stores: a DB placed in a public subnet shows a critical
 * finding in the security store; one click applies the fix as a single undoable command.
 */
import { describe, expect, it } from 'vitest';
import { createSecurityStore } from '@/canvas';
import { registry } from '@/registry';
import { createBoardStore, type BoardCommand } from '@/store';
import { planToCommands, startSecurityRunner } from './runner';

function setup() {
  let i = 0;
  const newId = (k: string) => `${k === 'group' ? 'grp' : k}_t${++i}`;
  const boardStore = createBoardStore({ registry, newId: newId as never });
  const securityStore = createSecurityStore();
  const runner = startSecurityRunner({ boardStore, securityStore, registry });
  const dispatch = (c: BoardCommand) => {
    const r = boardStore.getState().dispatch(c);
    if (!r.ok) throw new Error(r.reason);
  };
  return { boardStore, securityStore, runner, dispatch };
}

describe('security runner', () => {
  it('DB in a public subnet → critical finding → one-click fix → gone; undo brings it back', () => {
    const { boardStore, securityStore, dispatch, runner } = setup();
    dispatch({
      type: 'addNode',
      defId: 'compute.app-server',
      position: { x: 0, y: 0 },
      id: 'node_app',
      label: 'API',
    });
    dispatch({
      type: 'addNode',
      defId: 'database.postgres',
      position: { x: 300, y: 0 },
      id: 'node_db',
      label: 'Orders DB',
    });
    dispatch({
      type: 'group',
      kind: 'subnet',
      memberIds: ['node_db'],
      id: 'grp_pub',
      label: 'Public subnet',
    });
    dispatch({
      type: 'updateGroup',
      groupId: 'grp_pub',
      security: { public: true, firewallRules: [] },
    });

    const view = securityStore.getState().view!;
    expect(view.nodes.node_db).toMatchObject({ exposure: 'exposed' });
    expect(view.groups.grp_pub).toBe('Public');
    const f = view.findings[0]!;
    expect(f).toMatchObject({
      severity: 'critical',
      ruleId: 'rule.db-internet-reachable',
      title: '"Orders DB" is in a public zone',
      fixLabel: 'Make "Public subnet" a private data zone',
    });

    securityStore.getState().fix(f.key);
    expect(securityStore.getState().lastFix).toEqual({
      ok: true,
      message: 'Applied: Make "Public subnet" a private data zone (undo with Ctrl/⌘+Z)',
    });
    expect(boardStore.getState().doc.graph.groups[0]?.security).toEqual({
      public: false,
      zone: 'data',
      firewallRules: [],
    });
    const after = securityStore.getState().view!;
    expect(after.findings.some((x) => x.ruleId === 'rule.db-internet-reachable')).toBe(false);
    expect(after.nodes.node_db).toMatchObject({ exposure: 'internal', label: 'Data' });

    boardStore.getState().undo();
    expect(securityStore.getState().view!.findings[0]?.severity).toBe('critical');
    runner.dispose();
    expect(securityStore.getState().fixHandler).toBeNull();
  });

  it('mixed public subnet: the fix creates a data subnet beside it and moves the DB in', () => {
    const { boardStore, securityStore, dispatch } = setup();
    dispatch({
      type: 'addNode',
      defId: 'compute.app-server',
      position: { x: 0, y: 0 },
      id: 'node_app',
    });
    dispatch({
      type: 'addNode',
      defId: 'database.postgres',
      position: { x: 300, y: 0 },
      id: 'node_db',
    });
    dispatch({ type: 'group', kind: 'subnet', memberIds: ['node_app', 'node_db'], id: 'grp_pub' });
    dispatch({
      type: 'updateGroup',
      groupId: 'grp_pub',
      security: { public: true, firewallRules: [] },
    });
    const f = securityStore
      .getState()
      .view!.findings.find((x) => x.ruleId === 'rule.db-internet-reachable')!;
    securityStore.getState().fix(f.key);
    const g = boardStore.getState().doc.graph;
    const db = g.nodes.find((n) => n.id === 'node_db')!;
    const newGroup = g.groups.find((x) => x.id === db.groupId)!;
    expect(newGroup).toMatchObject({
      kind: 'subnet',
      label: 'Data subnet (private)',
      security: { zone: 'data' },
    });
    expect(newGroup.parentId).toBeUndefined();
    expect(db.position.x).toBeGreaterThan(300); // moved out of the old subnet's frame
    expect(
      securityStore
        .getState()
        .view!.findings.some((x) => x.ruleId === 'rule.db-internet-reachable'),
    ).toBe(false);
    // one undo step restores everything
    boardStore.getState().undo();
    expect(boardStore.getState().doc.graph.groups).toHaveLength(1);
  });

  it('plaintext and rate-limit fixes: TLS on the edge; a WAF inserted on the client edge', () => {
    const { boardStore, securityStore, dispatch } = setup();
    dispatch({ type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 }, id: 'node_web' });
    dispatch({
      type: 'addNode',
      defId: 'compute.app-server',
      position: { x: 400, y: 0 },
      id: 'node_app',
    });
    dispatch({
      type: 'connect',
      source: 'node_web',
      target: 'node_app',
      id: 'edge_1',
      protocol: 'http1',
    });
    dispatch({ type: 'updateEdge', edgeId: 'edge_1', protocolStack: ['tcp', 'http1'] });
    const find = (rule: string) =>
      securityStore.getState().view!.findings.find((x) => x.ruleId === rule)!;
    securityStore.getState().fix(find('rule.plaintext-edge').key);
    expect(boardStore.getState().doc.graph.edges[0]?.protocolStack).toEqual([
      'tcp',
      'tls13',
      'http1',
    ]);

    securityStore.getState().fix(find('rule.no-rate-limit-public-api').key);
    expect(securityStore.getState().lastFix?.ok).toBe(true);
    const g = boardStore.getState().doc.graph;
    const waf = g.nodes.find((n) => n.defId === 'security.waf')!;
    expect(waf.label).toBe('WAF');
    expect(g.edges.map((e) => [e.source, e.target])).toEqual([
      ['node_web', waf.id],
      [waf.id, 'node_app'],
    ]);
    expect(
      securityStore
        .getState()
        .view!.findings.some((x) => x.ruleId === 'rule.no-rate-limit-public-api'),
    ).toBe(false);
  });

  it('planToCommands: addNode places the new control under its neighbour and connects callers', () => {
    const cmds = planToCommands(
      {
        label: 'Add a secrets manager',
        steps: [
          {
            kind: 'addNode',
            defId: 'security.secrets-manager',
            label: 'Secrets Manager',
            near: 'node_a',
            connectFrom: ['node_a'],
          },
        ],
      },
      {
        graph: {
          nodes: [
            {
              id: 'node_a',
              defId: 'compute.app-server',
              label: 'a',
              position: { x: 10, y: 20 },
              config: {},
              scaling: { replicas: 1, instanceType: 'small' },
            },
          ],
          edges: [],
          groups: [],
        },
        layout: { groupFrames: {} },
      },
      (k) => `${k}_x`,
    );
    expect(cmds).toEqual([
      {
        type: 'addNode',
        defId: 'security.secrets-manager',
        label: 'Secrets Manager',
        id: 'node_x',
        position: { x: 10, y: 20 + 64 + 60 },
      },
      { type: 'connect', source: 'node_a', target: 'node_x', id: 'edge_x' },
    ]);
  });

  it('a stale key reports that there is no fix', () => {
    const { securityStore } = setup();
    securityStore.getState().fix('rule.nope:x');
    expect(securityStore.getState().lastFix).toMatchObject({ ok: false });
  });
});
