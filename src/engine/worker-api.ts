/** What the engine worker exposes over Comlink (also used in-thread when Workers are missing). */
import type { SimResult } from '@/core';
import { registry } from '@/registry';
import type { EngineOptions, SimInput } from './model/types';
import { simulate } from './simulate';

export const workerApi = {
  simulate(input: SimInput, options?: Partial<EngineOptions>): SimResult {
    return simulate(input, registry, options);
  },
};

export type WorkerApi = typeof workerApi;
