/** S18 Chaos presets/verdict and Learn quiz grading. */
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { simulate } from '@/engine';
import { CHAOS_PRESETS, chaosTargets, chaosVerdict, chaosWindow, injectCommand } from './chaos';
import chaos from './controllers/chaos';
import learn from './controllers/learn';
import { gradeQuiz, lessonBoardCommand, listLessons } from './learn';
import { makeCtx, problem } from './test-utils';

describe('chaos', () => {
  const p = problem('problem.url-shortener');
  const g = p.referenceSolutions[0]!;

  it('targets come from the problem’s SLOs', () => {
    expect(chaosTargets(p)).toEqual({ availability: 0.999, p99Ms: 300 });
    expect(chaosTargets(undefined)).toEqual({ availability: 0.99, p99Ms: 1000 });
    expect(chaosWindow({ ...p.scenario, durationSec: 60 })).toEqual({ atSec: 10, durationSec: 20 });
  });

  it('presets build valid events or say why not', () => {
    for (const preset of CHAOS_PRESETS) {
      const r = injectCommand(preset.id, g, p.scenario, `evt_${preset.id}`);
      expect(r.ok, preset.id).toBe(true);
    }
    const empty = { nodes: [], edges: [], groups: [] };
    expect(injectCommand('region-outage', empty, p.scenario, 'evt_x')).toMatchObject({ ok: false });
    expect(injectCommand('nope', g, p.scenario, 'evt_x')).toMatchObject({ ok: false });
  });

  it('verdict over the timeline: a single-region design fails a region outage', () => {
    const r = injectCommand('region-outage', g, p.scenario, 'evt_region');
    if (!r.ok || r.command.type !== 'updateScenario') throw new Error('no command');
    const scenario = { ...p.scenario, ...r.command.patch };
    const result = simulate({ graph: g, scenario, providerId: 'generic' }, registry, {
      timeline: true,
    });
    const ctx = makeCtx({ problem: p, graph: g, scenario, result });
    const v = chaosVerdict(ctx);
    expect(v.events).toBe(1);
    expect(v.availabilityOk).toBe(false);
    expect(v.passed).toBe(false);
    expect(v.summary).toMatch(/availability fell/i);
    let s = chaos.onEnter(ctx);
    s = chaos.onSimResult(s, ctx);
    expect(chaos.isComplete(s, ctx)).toBe(false);

    // A 1.2× spike is absorbed.
    const spike = {
      ...p.scenario,
      events: [
        { id: 'evt_s', kind: 'trafficSpike' as const, multiplier: 1.2, atSec: 10, durationSec: 20 },
      ],
    };
    const ok = makeCtx({
      problem: p,
      graph: g,
      scenario: spike,
      result: simulate({ graph: g, scenario: spike, providerId: 'generic' }, registry, {
        timeline: true,
      }),
    });
    expect(chaosVerdict(ok).passed).toBe(true);
    s = chaos.onSimResult(s, ok);
    expect(chaos.isComplete(s, ok)).toBe(true);
    expect(chaos.score!(s, ok)).toBe(100);
  });

  it('no events → asks for one', () => {
    expect(chaosVerdict(makeCtx()).summary).toMatch(/Inject a failure/);
  });
});

describe('learn', () => {
  const lessons = listLessons(registry);
  const l = lessons[0]!;

  it('lists five lessons, easiest first, each with a mini-board command', () => {
    expect(lessons).toHaveLength(5);
    expect(lessons.map((x) => x.level)).toEqual([...lessons.map((x) => x.level)].sort());
    expect(lessonBoardCommand(l)).toMatchObject({ type: 'replaceGraph' });
  });

  it('grades the quiz (2 of 3 passes)', () => {
    const right = l.quiz.map((q) => q.answerIndex);
    expect(gradeQuiz(l, right)).toMatchObject({ correct: 3, passed: true });
    const oneWrong = [...right];
    oneWrong[0] = (right[0]! + 1) % l.quiz[0]!.options.length;
    expect(gradeQuiz(l, oneWrong)).toMatchObject({ correct: 2, passed: true });
    expect(gradeQuiz(l, [right[0]!, null, null])).toMatchObject({ correct: 1, passed: false });
  });

  it('controller: open → answer → submit → complete, subject is the lesson', () => {
    const ctx = makeCtx();
    let s = learn.onEnter(ctx);
    expect(learn.subject!(s, ctx)).toBeUndefined();
    s = learn.onAction!(s, { type: 'open', lessonId: l.id }, ctx);
    s = learn.onAction!(s, { type: 'goto', step: 99 }, ctx);
    expect(s.step).toBe(l.steps.length);
    l.quiz.forEach(
      (q, i) =>
        (s = learn.onAction!(
          s,
          {
            type: 'answer',
            question: i,
            option: i === 0 ? (q.answerIndex + 1) % q.options.length : q.answerIndex,
          },
          ctx,
        )),
    );
    s = learn.onAction!(s, { type: 'submit' }, ctx);
    expect(learn.isComplete(s, ctx)).toBe(true);
    expect(learn.score!(s, ctx)).toBe(67);
    expect(learn.subject!(s, ctx)).toEqual({ kind: 'lesson', id: l.id, title: l.title });
  });
});
