import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sampleBoard } from '@/core';
import {
  defineComponent,
  defineLesson,
  defineProblem,
  defineProtocol,
  defineProvider,
  defineRule,
  registryKindOf,
  RegistryEntryError,
} from './define';

const component = {
  id: 'compute.test',
  name: 'Test',
  category: 'compute' as const,
  tags: [],
  icon: 'box',
  ports: [],
  configSchema: z.object({ n: z.number().int().min(1) }),
  defaults: { n: 1 },
  instanceTypes: [{ id: 'one', vCpu: 1, memGb: 1, netGbps: 1, costUsdPerHour: 0 }],
  perf: {
    serviceTimeMs: { read: 1, write: 1 },
    maxConcurrencyPerInstance: 1,
    scaleCurve: 'linear' as const,
    saturationBehavior: 'queue' as const,
  },
  docs: { summary: 'A test component.', howItWorks: '', tradeoffs: [], interviewTips: [] },
};

function errorOf(fn: () => unknown): RegistryEntryError {
  try {
    fn();
  } catch (e) {
    if (e instanceof RegistryEntryError) return e;
    throw e;
  }
  throw new Error('expected a RegistryEntryError');
}

describe('defineComponent', () => {
  it('returns a frozen, branded entry and keeps the config schema usable', () => {
    const c = defineComponent(component);
    expect(registryKindOf(c)).toBe('component');
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.docs.tradeoffs)).toBe(true);
    expect(c.configSchema.safeParse({ n: 2 }).success).toBe(true);
    expect(c.configSchema.safeParse({ n: 0 }).success).toBe(false);
  });

  it('rejects an empty docs.summary with a readable error naming the entry', () => {
    const e = errorOf(() =>
      defineComponent({ ...component, docs: { ...component.docs, summary: '  ' } }),
    );
    expect(e.message).toContain('Invalid component "compute.test"');
    expect(e.errors).toContain('docs.summary: Must not be empty');
  });

  it('rejects defaults that do not match configSchema', () => {
    const e = errorOf(() => defineComponent({ ...component, defaults: { n: 0 } }));
    expect(e.errors.join()).toMatch(/defaults\.n: defaults do not match configSchema/);
  });

  it('rejects unknown keys (typos)', () => {
    expect(() => defineComponent({ ...component, defualts: {} } as never)).toThrow(
      RegistryEntryError,
    );
  });

  it('does not brand plain objects', () => {
    expect(registryKindOf({ ...component })).toBeUndefined();
    expect(registryKindOf(null)).toBeUndefined();
  });
});

describe('defineProtocol', () => {
  it('validates the OSI layer', () => {
    const base = {
      id: 'udp',
      name: 'UDP',
      osiLayer: 4 as const,
      handshakeRtts: 0,
      perMessageOverheadBytes: 8,
      multiplexing: false,
      reliable: false,
      ordered: false,
      encrypted: false,
      runsOn: [],
      docs: { summary: 'Datagrams.', handshakeSteps: [], headerFields: [], securityNotes: [] },
    };
    expect(registryKindOf(defineProtocol(base))).toBe('protocol');
    expect(() => defineProtocol({ ...base, osiLayer: 9 as never })).toThrow(RegistryEntryError);
  });
});

describe('defineProvider', () => {
  const provider = {
    id: 'aws' as const,
    name: 'Amazon Web Services',
    shortName: 'AWS',
    regions: [{ id: 'us-east-1', name: 'N. Virginia', lat: 38.9, lon: -77.4 }],
    defaultRegionId: 'us-east-1',
    pricing: {
      asOf: '2026-10-01',
      region: 'us-east-1',
      instancePriceMultiplier: 1,
      egressUsdPerGb: 0.09,
      storageUsdPerGbMonth: 0.023,
      requestsUsdPerMillion: 0.4,
    },
    docs: { summary: 'AWS.', howItWorks: '', tradeoffs: [] },
  };
  it('accepts a valid provider', () => {
    expect(registryKindOf(defineProvider(provider))).toBe('provider');
  });
  it('requires defaultRegionId to be one of its regions', () => {
    const e = errorOf(() => defineProvider({ ...provider, defaultRegionId: 'eu-west-1' }));
    expect(e.errors.join()).toMatch(
      /defaultRegionId "eu-west-1" is not one of the provider's regions/,
    );
  });
  it('requires an "as of" date on the price table', () => {
    const e = errorOf(() =>
      defineProvider({ ...provider, pricing: { ...provider.pricing, asOf: 'Oct 2026' } }),
    );
    expect(e.errors.join()).toMatch(/"as of" date/);
  });
  it('requires the pricing region to be one of its regions', () => {
    const e = errorOf(() =>
      defineProvider({ ...provider, pricing: { ...provider.pricing, region: 'eu-west-1' } }),
    );
    expect(e.errors.join()).toMatch(/pricing.region "eu-west-1"/);
  });
  it('rejects a generic size mapped twice', () => {
    const size = { size: 'small', name: 'm7i.large', vCpu: 2, memGb: 8, costUsdPerHour: 0.1 };
    const e = errorOf(() =>
      defineProvider({
        ...provider,
        instanceFamilies: [{ id: 'general', name: 'General', sizes: [size, size] }],
      }),
    );
    expect(e.errors.join()).toMatch(/Generic size "small" is mapped twice/);
  });
  it('only accepts known provider ids', () => {
    expect(() => defineProvider({ ...provider, id: 'oracle' as never })).toThrow(
      RegistryEntryError,
    );
  });
});

describe('defineRule', () => {
  const rule = {
    id: 'rule.test',
    title: 'Test rule',
    category: 'reliability' as const,
    severity: 'warning' as const,
    tags: [],
    check: () => [],
    docs: { summary: 'Flags nothing.', why: '', howToFix: '' },
  };
  it('keeps the check function callable', () => {
    const r = defineRule(rule);
    expect(r.check({ graph: sampleBoard.graph, components: { get: () => undefined } })).toEqual([]);
  });
  it('requires check to be a function', () => {
    const e = errorOf(() => defineRule({ ...rule, check: 'nope' as never }));
    expect(e.errors.join()).toMatch(/check must be a function/);
  });
});

describe('defineLesson', () => {
  const lesson = {
    id: 'lesson.test',
    title: 'Test lesson',
    level: 1,
    tags: [],
    related: ['tcp'],
    steps: [{ title: 'Step', body: 'Body' }],
    quiz: [{ question: 'Q?', options: ['a', 'b'], answerIndex: 1, explanation: '' }],
    docs: { summary: 'A lesson.' },
  };
  it('accepts a valid lesson', () => {
    expect(registryKindOf(defineLesson(lesson))).toBe('lesson');
  });
  it('rejects a quiz answer index out of range', () => {
    const e = errorOf(() =>
      defineLesson({ ...lesson, quiz: [{ ...lesson.quiz[0]!, answerIndex: 2 }] }),
    );
    expect(e.errors.join()).toMatch(
      /quiz\[0\]\.answerIndex: answerIndex must point at one of the options/,
    );
  });
});

describe('defineProblem', () => {
  const problem = {
    id: 'problem.test',
    title: 'Test problem',
    level: 1,
    tags: [],
    requirements: { functional: ['Do a thing'], nonFunctional: [] },
    scale: { dau: 1000, readWriteRatio: 10, dataSizeBytes: 1e6 },
    scenario: sampleBoard.scenario,
    hints: [],
    referenceSolutions: [sampleBoard.graph],
    rubric: [],
    debugVariants: [],
    docs: { summary: 'A practice problem.' },
  };
  it('accepts a valid problem', () => {
    expect(registryKindOf(defineProblem(problem))).toBe('problem');
  });
  it('requires docs in the registry (optional in core)', () => {
    const noDocs: Partial<typeof problem> = { ...problem };
    delete noDocs.docs;
    expect(() => defineProblem(noDocs as never)).toThrow(RegistryEntryError);
  });
});
