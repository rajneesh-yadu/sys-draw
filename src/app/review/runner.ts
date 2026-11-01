/**
 * Wires the engine's design review to the canvas's review store (S19): re-reviews the open board
 * when its graph or scenario changes or a new simulation result for it arrives, and applies a
 * finding's one-click fix as ONE undoable batch of board commands (same plan → command mapping as
 * the security fixes). No review logic here: it only maps data and fix plans.
 */
import type { FixHandler, ReviewStore, ReviewView } from '@/canvas';
import type { IdKind } from '@/core';
import { designFix, reviewDesign } from '@/engine';
import type { Registry } from '@/registry';
import type {
  BoardCommand,
  BoardDoc,
  BoardStore,
  SimResult,
  SimulationStore,
  WorkspaceStore,
} from '@/store';
import { planToCommands } from '../security/runner';

/** The canvas's view of the design review of one board. */
export function toReviewView(
  doc: Pick<BoardDoc, 'graph' | 'scenario'>,
  result: SimResult | null,
  registry: Registry,
): ReviewView {
  const r = reviewDesign({ graph: doc.graph, scenario: doc.scenario, result, registry });
  return {
    findings: r.findings,
    checked: r.checked.length,
    skipped: r.skipped.map((s) => ({
      ...s,
      title: registry.get(s.ruleId, 'rule')?.title ?? s.ruleId,
    })),
    hasResult: result !== null,
  };
}

/** Applies the fix of finding `key` on the board store's open board (one undo step). */
export function applyReviewFix(
  boardStore: BoardStore,
  registry: Registry,
  key: string,
  result: SimResult | null,
  newId?: (kind: IdKind) => string,
): ReturnType<FixHandler> {
  const { doc } = boardStore.getState();
  const plan = designFix({ graph: doc.graph, scenario: doc.scenario, result, registry }, key);
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

export interface ReviewRunnerOptions {
  boardStore: BoardStore;
  reviewStore: ReviewStore;
  registry: Registry;
  /** Source of simulation results (optional: without it, result-based rules are skipped). */
  simulationStore?: SimulationStore | undefined;
  workspaceStore?: WorkspaceStore | undefined;
}

/** Keeps the review current with the open board (and its latest result); registers the fix handler. */
export function startReviewRunner(opts: ReviewRunnerOptions): { dispose(): void } {
  const { boardStore, reviewStore, registry, simulationStore, workspaceStore } = opts;
  /** The latest result, only when it belongs to the open board. */
  const currentResult = (): SimResult | null => {
    const sim = simulationStore?.getState();
    if (!sim?.result) return null;
    const active = workspaceStore?.getState().activeBoardId;
    if (active !== undefined && sim.boardId !== null && sim.boardId !== active) return null;
    return sim.result;
  };
  const refresh = () => {
    const { doc } = boardStore.getState();
    let view: ReviewView | null;
    try {
      view = toReviewView(doc, currentResult(), registry);
    } catch {
      view = null;
    }
    reviewStore.getState().setView(view);
  };
  reviewStore
    .getState()
    .setFixHandler((key) => applyReviewFix(boardStore, registry, key, currentResult()));
  refresh();
  const unsubBoard = boardStore.subscribe((s, prev) => {
    if (s.doc.graph !== prev.doc.graph || s.doc.scenario !== prev.doc.scenario) refresh();
  });
  const unsubSim = simulationStore?.subscribe((s, prev) => {
    if (s.result !== prev.result || s.boardId !== prev.boardId) refresh();
  });
  return {
    dispose() {
      unsubBoard();
      unsubSim?.();
      reviewStore.getState().setFixHandler(null);
    },
  };
}
