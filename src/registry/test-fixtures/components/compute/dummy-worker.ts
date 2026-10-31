import { z } from 'zod';
import { defineComponent } from '../../../define';

/** A dummy component used to prove auto-discovery. Never loaded by the app. */
export const dummyWorker = defineComponent({
  id: 'compute.dummy-worker',
  name: 'Dummy Worker',
  category: 'compute',
  tags: ['test-only'],
  icon: 'box',
  providerNames: { aws: 'Dummy on AWS' },
  ports: [{ id: 'in', direction: 'in', protocols: ['http1'] }],
  configSchema: z.object({ threads: z.number().int().min(1) }),
  defaults: { threads: 1 },
  instanceTypes: [{ id: 'tiny', vCpu: 1, memGb: 1, netGbps: 1, costUsdPerHour: 0.01 }],
  perf: {
    serviceTimeMs: { read: 1, write: 1 },
    maxConcurrencyPerInstance: 1,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  docs: { summary: 'Test-only component.', howItWorks: '', tradeoffs: [], interviewTips: [] },
});
