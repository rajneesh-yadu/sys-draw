/** What the engine worker exposes over Comlink (also used in-thread when Workers are missing). */
import type { SimResult } from '@/core';
import { registry } from '@/registry';
import type { EngineOptions, SimInput } from './model/types';
import { simulate } from './simulate';
import { traceRequest, type RequestTrace, type TraceOptions } from './trace/trace';

export const workerApi = {
  simulate(input: SimInput, options?: Partial<EngineOptions>): SimResult {
    return simulate(input, registry, options);
  },
  /** S15: one request end to end (options without `registry`: the app registry is used). */
  trace(
    input: SimInput,
    flowId: string | undefined,
    userRegionId: string | undefined,
    options?: Omit<TraceOptions, 'registry'>,
  ): RequestTrace {
    return traceRequest(input, flowId, userRegionId, { ...options, registry });
  },
};

export type WorkerApi = typeof workerApi;
