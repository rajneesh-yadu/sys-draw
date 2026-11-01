/** Main-thread side of the engine worker. */
import { type Remote, wrap } from 'comlink';
import type { SimResult } from '@/core';
import type { EngineOptions, SimInput } from './model/types';
import type { RequestTrace, TraceOptions } from './trace/trace';
import type { WorkerApi } from './worker-api';

let worker: Worker | undefined;
let remote: Remote<WorkerApi> | undefined;

/**
 * Simulate a board (any object with `graph`, `scenario` and optional `providerId`) in the engine
 * Web Worker. Falls back to running in-thread where Workers don't exist (tests, SSR).
 */
function engineInput(board: SimInput): SimInput {
  return {
    graph: board.graph,
    scenario: board.scenario,
    ...(board.providerId !== undefined ? { providerId: board.providerId } : {}),
  };
}

function remoteApi(): Remote<WorkerApi> {
  if (!remote) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'sysdraw-engine',
    });
    remote = wrap<WorkerApi>(worker);
  }
  return remote;
}

/**
 * S15: trace one request of a flow from a user region (see trace/trace.ts) in the engine worker;
 * in-thread where Workers don't exist.
 */
export async function runTrace(
  board: SimInput,
  flowId: string | undefined,
  userRegionId: string | undefined,
  options?: Omit<TraceOptions, 'registry'>,
): Promise<RequestTrace> {
  const input = engineInput(board);
  if (typeof Worker === 'undefined') {
    const { workerApi } = await import('./worker-api');
    return workerApi.trace(input, flowId, userRegionId, options);
  }
  return remoteApi().trace(input, flowId, userRegionId, options);
}

export async function runSimulation(
  board: SimInput,
  options?: Partial<EngineOptions>,
): Promise<SimResult> {
  // Send only what the engine reads (boards carry snapshots and cached results).
  const input = engineInput(board);
  if (typeof Worker === 'undefined') {
    const { workerApi } = await import('./worker-api');
    return workerApi.simulate(input, options);
  }
  return remoteApi().simulate(input, options);
}

/** Stop the worker (it restarts on the next `runSimulation`). */
export function disposeSimulationWorker(): void {
  worker?.terminate();
  worker = undefined;
  remote = undefined;
}
