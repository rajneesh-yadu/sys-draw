/** Test helpers (not exported from index.ts). */
import { simulate } from '@/engine';
import { registry } from '@/registry';
import { defaultScenario, type Graph, type Scenario, type SimResult } from '@/store';
import type { ModeContext, Problem } from './types';

export function simulateBoard(graph: Graph, scenario: Scenario): SimResult {
  return simulate({ graph, scenario, providerId: 'generic' }, registry);
}

export function makeCtx(over: Partial<ModeContext> = {}): ModeContext {
  return {
    boardId: 'board_test',
    graph: { nodes: [], edges: [], groups: [] },
    scenario: defaultScenario(),
    problem: undefined,
    result: null,
    registry,
    nowMs: 1_000_000,
    ...over,
  };
}

export function problemCtx(problem: Problem, graph: Graph, over: Partial<ModeContext> = {}) {
  const scenario = structuredClone(problem.scenario);
  return makeCtx({ problem, graph, scenario, result: simulateBoard(graph, scenario), ...over });
}

export const problem = (id: string): Problem => registry.require(id, 'problem');
