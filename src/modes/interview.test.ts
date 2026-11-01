/** S18 Interview mode: clock, follow-ups, scorecard. */
import { describe, expect, it } from 'vitest';
import interview from './controllers/interview';
import {
  formatClock,
  INTERVIEW_DURATION_MS,
  INTERVIEW_PROMPTS,
  promptsDue,
  totalScore,
} from './interview';
import { makeCtx, problem, problemCtx } from './test-utils';

const p = problem('problem.url-shortener');
const MIN = 60_000;

describe('interview', () => {
  it('formats the clock and lists due prompts', () => {
    expect(formatClock(INTERVIEW_DURATION_MS)).toBe('45:00');
    expect(formatClock(59_001)).toBe('01:00');
    expect(promptsDue(0)).toEqual([]);
    expect(promptsDue(15 * MIN)).toEqual(['scope', 'read-path']);
    expect(promptsDue(INTERVIEW_DURATION_MS)).toHaveLength(INTERVIEW_PROMPTS.length);
  });

  it('total = 70 % rubric + 15 % cost + 15 % self-review (renormalised without cost)', () => {
    expect(totalScore({ rubricShare: 1, costShare: 1, selfReviewShare: 1 })).toBe(100);
    expect(totalScore({ rubricShare: 0.5, costShare: 0, selfReviewShare: 1 })).toBe(50);
    // (0.7 × 0.5 + 0.15 × 1) / 0.85 = 58.8 %
    expect(totalScore({ rubricShare: 0.5, costShare: undefined, selfReviewShare: 1 })).toBe(59);
  });

  it('timer, follow-ups and auto-finish at 45:00', () => {
    const ctx = problemCtx(p, p.referenceSolutions[0]!);
    let s = interview.onEnter(ctx);
    expect(s.startedAtMs).toBe(ctx.nowMs);
    s = interview.onTick!(s, { ...ctx, nowMs: ctx.nowMs + 16 * MIN });
    expect(s.asked).toEqual(['scope', 'read-path']);
    expect(s.finished).toBe(false);
    s = interview.onTick!(s, { ...ctx, nowMs: ctx.nowMs + 46 * MIN });
    expect(s.finished).toBe(true);
    expect(s.elapsedMs).toBe(INTERVIEW_DURATION_MS);
    expect(s.scorecard?.endedBy).toBe('timer');
    expect(interview.isComplete(s, ctx)).toBe(true);
  });

  it('finish → scorecard; self-review and the reference cost re-total it', () => {
    const ctx = problemCtx(p, p.referenceSolutions[0]!);
    let s = interview.onEnter(ctx);
    s = interview.onAction!(s, { type: 'finish' }, { ...ctx, nowMs: ctx.nowMs + 20 * MIN });
    const card = s.scorecard!;
    expect(card.endedBy).toBe('user');
    expect(card.rubricShare).toBe(1);
    expect(card.total).toBe(82); // 0.7 / 0.85
    expect(interview.needsReferenceCost!(s)).toBe(true);
    s = interview.onAction!(s, { type: 'referenceCost', costPerMonth: card.costPerMonth! }, ctx);
    expect(s.scorecard!.costShare).toBe(1);
    expect(s.scorecard!.total).toBe(85);
    expect(interview.needsReferenceCost!(s)).toBe(false);
    for (const id of ['clarified', 'estimated', 'api-data', 'tradeoffs', 'failures', 'answered'])
      s = interview.onAction!(s, { type: 'toggleSelfReview', id }, ctx);
    expect(s.scorecard!.total).toBe(100);
    expect(interview.score!(s, ctx)).toBe(100);
  });

  it('an empty board scores 0 on the rubric; the clock waits for a problem', () => {
    const empty = makeCtx({ problem: p, scenario: p.scenario });
    const s = interview.onAction!(interview.onEnter(empty), { type: 'finish' }, empty);
    expect(s.scorecard!.rubricShare).toBe(0);
    const free = interview.onEnter(makeCtx());
    expect(free.startedAtMs).toBeUndefined();
    expect(interview.onTick!(free, makeCtx()).startedAtMs).toBeUndefined();
    expect(interview.onTick!(free, makeCtx({ problem: p })).startedAtMs).toBe(1_000_000);
  });
});
