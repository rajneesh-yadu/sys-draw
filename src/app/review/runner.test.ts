/**
 * S19 end to end through the stores: a lone app server shows a SPOF finding in the review store;
 * "apply fix" adds a replica + load balancer as one undoable command; a simulation result for the
 * open board unlocks result-based rules, and a result of another board is ignored.
 */
import { describe, expect, it } from 'vitest';
import { createReviewStore } from '@/canvas';
import type { FixPlan } from '@/registry';
import { registry } from '@/registry';
import { simulate } from '@/engine';
import {
  createBoardStore,
  createSimulationStore,
  type BoardCommand,
  type WorkspaceStore,
} from '@/store';
import { planToCommands } from '../security/runner';
import { startReviewRunner } from './runner';

function setup(activeBoardId = 'board_a') {
  let i = 0;
  const newId = (k: string) => `${k === 'group' ? 'grp' : k}_t${++i}`;
  const boardStore = createBoardStore({ registry, newId: newId as never });
  const reviewStore = createReviewStore();
  const simulationStore = createSimulationStore();
  const workspaceStore = { getState: () => ({ activeBoardId }) } as unknown as WorkspaceStore;
  const runner = startReviewRunner({
    boardStore,
    reviewStore,
    registry,
    simulationStore,
    workspaceStore,
  });
  const dispatch = (c: BoardCommand) => {
    const r = boardStore.getState().dispatch(c);
    if (!r.ok) throw new Error(r.reason);
  };
  dispatch({
    type: 'addNode',
    defId: 'client.app',
    position: { x: 0, y: 0 },
    id: 'node_c',
    label: 'Users',
  });
  dispatch({
    type: 'addNode',
    defId: 'compute.app-server',
    position: { x: 300, y: 0 },
    id: 'node_app',
    label: 'API',
  });
  dispatch({ type: 'connect', source: 'node_c', target: 'node_app', id: 'edge_c_app' });
  return { boardStore, reviewStore, simulationStore, runner, dispatch };
}

describe('review runner', () => {
  it('SPOF → one-click fix (2 replicas + LB, one undo step) → gone; undo brings it back', () => {
    const { boardStore, reviewStore, runner } = setup();
    const view = reviewStore.getState().view!;
    expect(view.hasResult).toBe(false);
    const f = view.findings.find((x) => x.ruleId === 'rule.spof')!;
    expect(f).toMatchObject({
      severity: 'error',
      category: 'reliability',
      title: '"API" is a single point of failure',
      fixLabel: 'Run 2 replicas of API behind a load balancer',
    });
    expect(view.skipped.find((s) => s.ruleId === 'rule.overloaded-node')).toEqual({
      ruleId: 'rule.overloaded-node',
      title: 'Overloaded component',
      reason: 'needs a simulation result',
    });

    reviewStore.getState().fix(f.key);
    expect(reviewStore.getState().lastFix).toEqual({
      ok: true,
      message: 'Applied: Run 2 replicas of API behind a load balancer (undo with Ctrl/⌘+Z)',
    });
    const g = boardStore.getState().doc.graph;
    expect(g.nodes.find((n) => n.id === 'node_app')!.scaling.replicas).toBe(2);
    const lb = g.nodes.find((n) => n.defId === 'network.load-balancer')!;
    expect(g.edges.map((e) => [e.source, e.target]).sort()).toEqual(
      [
        ['node_c', lb.id],
        [lb.id, 'node_app'],
      ].sort(),
    );
    const after = reviewStore.getState().view!.findings;
    expect(after.some((x) => x.ruleId === 'rule.spof')).toBe(false);
    expect(after.some((x) => x.ruleId === 'rule.no-lb-before-replicas')).toBe(false);

    boardStore.getState().undo(); // the whole fix is one step
    expect(boardStore.getState().doc.graph.nodes).toHaveLength(2);
    expect(reviewStore.getState().view!.findings.some((x) => x.ruleId === 'rule.spof')).toBe(true);
    runner.dispose();
    expect(reviewStore.getState().fixHandler).toBeNull();
  });

  it('a result for the open board runs result-based rules; one for another board is ignored', () => {
    const { boardStore, reviewStore, simulationStore } = setup();
    const { doc } = boardStore.getState();
    const hot = simulate(
      {
        graph: doc.graph,
        scenario: { ...doc.scenario, usersByRegion: { 'north-america': 5_000_000 } },
      },
      registry,
    );
    const other = simulationStore.getState().start();
    simulationStore.getState().finish(other, 'board_other', hot);
    expect(reviewStore.getState().view!.hasResult).toBe(false);

    const run = simulationStore.getState().start();
    simulationStore.getState().finish(run, 'board_a', hot);
    const view = reviewStore.getState().view!;
    expect(view.hasResult).toBe(true);
    const over = view.findings.find((x) => x.ruleId === 'rule.overloaded-node')!;
    expect(over.targetIds).toEqual(['node_app']);
    expect(over.fixLabel).toMatch(/^Scale API to \d+ replicas$/);
  });

  it('a fix that no longer applies reports why instead of changing the board', () => {
    const { reviewStore } = setup();
    reviewStore.getState().fix('rule.spof:node_gone:nope');
    expect(reviewStore.getState().lastFix).toEqual({
      ok: false,
      message: 'This finding has no automatic fix any more (the board changed).',
    });
  });
});

describe('planToCommands: S19 steps', () => {
  it('maps node config, scaling and edge config steps onto store commands', () => {
    const plan: FixPlan = {
      label: 'x',
      steps: [
        { kind: 'setNodeConfig', nodeId: 'node_db', config: { queryUsesIndex: true } },
        { kind: 'setNodeScaling', nodeId: 'node_app', replicas: 3 },
        {
          kind: 'setNodeScaling',
          nodeId: 'node_app',
          autoscale: { min: 2, max: 6, targetUtil: 0.6, warmupSec: 60 },
        },
        {
          kind: 'setEdgeConfig',
          edgeId: 'edge_x',
          config: { retries: 3, backoff: 'exp', timeoutMs: null },
        },
      ],
    };
    expect(
      planToCommands(plan, {
        graph: { nodes: [], edges: [], groups: [] },
        layout: { groupFrames: {} },
      } as never),
    ).toEqual([
      { type: 'updateConfig', nodeId: 'node_db', config: { queryUsesIndex: true } },
      { type: 'updateNode', nodeId: 'node_app', scaling: { replicas: 3 } },
      {
        type: 'updateNode',
        nodeId: 'node_app',
        scaling: { autoscale: { min: 2, max: 6, targetUtil: 0.6, warmupSec: 60 } },
      },
      {
        type: 'updateEdge',
        edgeId: 'edge_x',
        config: { retries: 3, backoff: 'exp', timeoutMs: null },
      },
    ]);
  });
});
