import { describe, expect, it } from 'vitest';
import { GraphSchema } from '@/core';
import { simulate } from '@/engine';
import { registry } from '@/registry';
import { createAppStores } from '@/store';
import {
  loadPerfFixture,
  PERF_FIXTURE_BOARD_NAME,
  perfFixtureCommand,
  perfFixtureShape,
} from './fixture';

describe('300-node performance fixture (S21)', () => {
  it('splits 300 nodes into tiers', () => {
    const s = perfFixtureShape(300);
    expect(s).toEqual({ clients: 1, lbs: 4, apps: 280, caches: 5, dbs: 10 });
    expect(s.clients + s.lbs + s.apps + s.caches + s.dbs).toBe(300);
    const small = perfFixtureShape(20);
    expect(small.clients + small.lbs + small.apps + small.caches + small.dbs).toBe(20);
  });

  it('builds a valid board as one undo step: 300 nodes, 844 connections, unique positions', () => {
    const { boardStore, workspaceStore } = createAppStores();
    const r = loadPerfFixture(workspaceStore, boardStore);
    expect(r.ok).toBe(true);
    const ws = workspaceStore.getState();
    expect(ws.data.boards[ws.activeBoardId]?.name).toBe(PERF_FIXTURE_BOARD_NAME);
    const { graph } = boardStore.getState().doc;
    expect(graph.nodes).toHaveLength(300);
    // client → 4 LBs, then each of 280 apps: LB → app, app → Redis, app → Postgres.
    expect(graph.edges).toHaveLength(4 + 280 * 3);
    expect(GraphSchema.safeParse(graph).success).toBe(true);
    expect(new Set(graph.nodes.map((n) => `${n.position.x},${n.position.y}`)).size).toBe(300);
    // Every edge got a registry protocol stack.
    expect(graph.edges.every((e) => e.protocolStack.length > 0)).toBe(true);
    expect(boardStore.getState().past).toHaveLength(1);
    boardStore.getState().undo();
    expect(boardStore.getState().doc.graph.nodes).toHaveLength(0);
  });

  it('is deterministic (same ids and positions every time)', () => {
    expect(perfFixtureCommand()).toEqual(perfFixtureCommand());
  });

  it('simulates the whole fixture in well under 1 s', () => {
    const { boardStore, workspaceStore } = createAppStores();
    loadPerfFixture(workspaceStore, boardStore);
    const { graph, scenario } = boardStore.getState().doc;
    const t0 = performance.now();
    const result = simulate({ graph, scenario }, registry);
    const ms = performance.now() - t0;
    expect(Object.keys(result.perNode)).toHaveLength(300);
    expect(ms).toBeLessThan(1000);
  });
});
