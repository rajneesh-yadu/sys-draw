/** S18 Guided mode: the seven cards and their checks. */
import { describe, expect, it } from 'vitest';
import guided from './controllers/guided';
import {
  apiEndpoints,
  entities,
  GUIDED_STEPS,
  guidedSteps,
  initialGuidedState,
  withinFactor,
  type GuidedState,
} from './guided';
import { makeCtx, problem, problemCtx } from './test-utils';

const p = problem('problem.url-shortener');

describe('guided steps', () => {
  it('has the seven cards in interview order', () => {
    expect(GUIDED_STEPS.map((s) => s.id)).toEqual([
      'requirements',
      'estimates',
      'api',
      'data-model',
      'hld',
      'scaling',
      'bottlenecks',
    ]);
  });

  it('parses API lines and entities', () => {
    expect(apiEndpoints('POST /urls\nGET /{alias}\nfoo\nrpc Send(Msg)')).toHaveLength(3);
    expect(entities('Url: alias, longUrl, createdAt\nUser(id, email)\nnotes')).toEqual([
      { name: 'Url', fields: ['alias', 'longUrl', 'createdAt'] },
      { name: 'User', fields: ['id', 'email'] },
    ]);
    expect(withinFactor(16_000, 30_600, 2)).toBe(true);
    expect(withinFactor(15_000, 30_600, 2)).toBe(false);
    expect(withinFactor(undefined, 1, 2)).toBe(false);
  });

  it('an empty board fails every card; the reference + answers pass them all', () => {
    const empty = makeCtx({ problem: p, scenario: p.scenario });
    const s0 = initialGuidedState();
    expect(guidedSteps(s0, empty).map((s) => s.passed)).toEqual(Array(7).fill(false));

    const ctx = problemCtx(p, p.referenceSolutions[0]!);
    const answered: GuidedState = {
      ...s0,
      checked: [...p.requirements.functional, ...p.requirements.nonFunctional],
      estimates: { peakRps: 30_000, storageBytes: 5e12 },
      notes: {
        api: 'POST /urls\nGET /{alias}',
        'data-model': 'Url: alias, longUrl, expiresAt\nClick: alias, at, country',
        bottlenecks: 'The single key-value store partitions get hot first; add more partitions.',
      },
    };
    const steps = guidedSteps(answered, ctx);
    expect(steps.filter((s) => !s.passed).map((s) => [s.id, s.items])).toEqual([]);
  });

  it('controller: actions update answers and completion latches with a score', () => {
    const ctx = problemCtx(p, p.referenceSolutions[0]!);
    let s = guided.onEnter(ctx);
    expect(guided.isComplete(s, ctx)).toBe(false);
    const act = (a: Record<string, unknown> & { type: string }) =>
      (s = guided.onAction!(s, a, ctx));
    for (const r of [...p.requirements.functional, ...p.requirements.nonFunctional])
      act({ type: 'toggleRequirement', text: r });
    act({ type: 'setEstimate', field: 'peakRps', value: 25_000 });
    act({ type: 'setEstimate', field: 'storageBytes', value: 3e12 });
    act({ type: 'setNote', step: 'api', text: 'POST /urls\nGET /{alias}' });
    act({ type: 'setNote', step: 'data-model', text: 'Url: alias, longUrl\nClick: alias, at' });
    act({ type: 'hint' });
    act({ type: 'goto', step: 99 });
    expect(s.step).toBe(6);
    expect(guided.isComplete(s, ctx)).toBe(false);
    act({
      type: 'setNote',
      step: 'bottlenecks',
      text: 'Cache memory first: add shards at 10x traffic.',
    });
    expect(guided.isComplete(s, ctx)).toBe(true);
    expect(guided.score!(s, ctx)).toBe(92);
  });

  it('free board: requirements are written, latency defaults to p99 < 500 ms', () => {
    const ctx = makeCtx();
    const s = { ...initialGuidedState(), notes: { requirements: 'a\nb\nc' } };
    const steps = guidedSteps(s, ctx);
    expect(steps[0]!.passed).toBe(true);
    expect(steps[1]!.items[0]!.label).toMatch(/users and flows/);
  });
});
