/**
 * Wires the engine to the stores (S08): re-simulates the open board 300 ms after its graph,
 * scenario or provider last changed, at once when another board opens or "Run" is pressed,
 * and drops results of superseded runs. Contains no metric logic: it only moves data.
 */
import type { SimInput } from '@/engine';
import type { BoardStore, SimResult, SimulationStore, WorkspaceStore } from '@/store';

export const SIMULATION_DEBOUNCE_MS = 300;

export interface SimulationRunnerOptions {
  boardStore: BoardStore;
  workspaceStore: WorkspaceStore;
  simulationStore: SimulationStore;
  /** The engine entry point (`runSimulation` in the app; a stub in tests). */
  run: (input: SimInput) => Promise<SimResult>;
  debounceMs?: number;
  now?: () => number;
}

export interface SimulationRunner {
  /** Run immediately (cancels a pending debounced run). */
  runNow(): void;
  dispose(): void;
}

export function startSimulationRunner(opts: SimulationRunnerOptions): SimulationRunner {
  const { boardStore, workspaceStore, simulationStore, run } = opts;
  const debounceMs = opts.debounceMs ?? SIMULATION_DEBOUNCE_MS;
  const now = opts.now ?? (() => performance.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  // Inputs of the last run started, so a debounced run that would see identical inputs is skipped.
  let lastInputs: readonly unknown[] | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const execute = (force: boolean) => {
    cancel();
    if (disposed) return;
    const { doc } = boardStore.getState();
    const inputs = [doc.graph, doc.scenario, doc.providerId] as const;
    if (!force && lastInputs && inputs.every((v, i) => v === lastInputs?.[i])) return;
    lastInputs = inputs;
    const boardId = workspaceStore.getState().activeBoardId;
    const sim = simulationStore.getState();
    const runId = sim.start();
    const t0 = now();
    let pending: Promise<SimResult>;
    try {
      pending = run({ graph: doc.graph, scenario: doc.scenario, providerId: doc.providerId });
    } catch (e) {
      pending = Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    pending.then(
      (result) => {
        if (!disposed) simulationStore.getState().finish(runId, boardId, result, now() - t0);
      },
      (e: unknown) => {
        if (!disposed)
          simulationStore
            .getState()
            .fail(runId, e instanceof Error ? e.message : `Simulation failed: ${String(e)}`);
      },
    );
  };

  const schedule = () => {
    cancel();
    timer = setTimeout(() => execute(false), debounceMs);
  };

  const unsubBoard = boardStore.subscribe((s, prev) => {
    if (
      s.doc.graph !== prev.doc.graph ||
      s.doc.scenario !== prev.doc.scenario ||
      s.doc.providerId !== prev.doc.providerId
    ) {
      schedule();
    }
  });

  const unsubWorkspace = workspaceStore.subscribe((s, prev) => {
    if (s.activeBoardId === prev.activeBoardId) return;
    // Another board: its old numbers must not show on this one.
    simulationStore.getState().clear();
    execute(true);
  });

  const unsubSim = simulationStore.subscribe((s, prev) => {
    if (s.runRequests !== prev.runRequests) execute(true);
  });

  execute(true);

  return {
    runNow: () => execute(true),
    dispose() {
      disposed = true;
      cancel();
      unsubBoard();
      unsubWorkspace();
      unsubSim();
    },
  };
}
