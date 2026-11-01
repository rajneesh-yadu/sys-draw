/** S18 progress: versioned local file, attempts and per-problem summaries. */
import { describe, expect, it } from 'vitest';
import {
  createProgressStore,
  formatDuration,
  memoryProgressStorage,
  parseProgress,
  progressSummary,
  PROGRESS_MIGRATIONS,
  type Attempt,
} from './progress';

const a = (over: Partial<Attempt>): Attempt => ({
  id: 'att_1',
  subjectKind: 'problem',
  subjectId: 'problem.url-shortener',
  title: 'URL shortener',
  mode: 'interview',
  boardId: 'board_1',
  startedAt: '2026-11-01T10:00:00.000Z',
  durationMs: 60_000,
  completed: true,
  score: 70,
  ...over,
});

describe('progress file', () => {
  it('round-trips through storage and replaces attempts by id', () => {
    const storage = memoryProgressStorage();
    const store = createProgressStore(storage);
    store.getState().record(a({}));
    store.getState().record(a({ score: 80 }));
    store.getState().record(a({ id: 'att_2', completed: false, score: undefined }));
    const again = createProgressStore(storage);
    expect(again.getState().attempts).toHaveLength(2);
    expect(again.getState().attempts.find((x) => x.id === 'att_1')?.score).toBe(80);
    expect(JSON.parse(storage.load()!).schemaVersion).toBe(1);
    again.getState().clear();
    expect(createProgressStore(storage).getState().attempts).toEqual([]);
  });

  it('starts fresh (with a warning) on bad JSON, invalid data or a newer version', () => {
    expect(parseProgress(null).warning).toBeUndefined();
    expect(parseProgress('{oops').warning).toMatch(/JSON/);
    expect(parseProgress('{"schemaVersion":1,"attempts":[{"id":1}]}').warning).toMatch(
      /validation/,
    );
    expect(parseProgress('{"schemaVersion":7,"attempts":[]}').warning).toMatch(/newer/);
    expect(parseProgress('{"attempts":[]}').warning).toMatch(
      /No migration from progress version 0/,
    );
  });

  it('runs forward migrations', () => {
    PROGRESS_MIGRATIONS[0] = (d) => ({ attempts: (d.runs as unknown[]) ?? [] });
    try {
      const out = parseProgress(JSON.stringify({ runs: [a({})] }));
      expect(out.warning).toBeUndefined();
      expect(out.file.attempts).toHaveLength(1);
    } finally {
      delete PROGRESS_MIGRATIONS[0];
    }
  });
});

describe('summary', () => {
  it('groups attempts per subject: attempts, best/last score, time, per mode', () => {
    const rows = progressSummary([
      a({ id: '1', score: 70, durationMs: 30 * 60_000 }),
      a({
        id: '2',
        score: 55,
        startedAt: '2026-11-01T12:00:00.000Z',
        mode: 'guided',
        durationMs: 600_000,
      }),
      a({ id: '3', completed: false, score: undefined, startedAt: '2026-11-01T13:00:00.000Z' }),
      a({
        id: '4',
        subjectKind: 'lesson',
        subjectId: 'lesson.cap-theorem',
        title: 'CAP',
        mode: 'learn',
        startedAt: '2026-10-30T09:00:00.000Z',
      }),
    ]);
    expect(rows.map((r) => r.subjectId)).toEqual(['problem.url-shortener', 'lesson.cap-theorem']);
    expect(rows[0]).toMatchObject({
      attempts: 3,
      completed: 2,
      bestScore: 70,
      lastScore: 55,
      totalMs: 41 * 60_000,
    });
    expect(rows[0]!.byMode).toEqual([
      { mode: 'interview', attempts: 2, bestScore: 70, totalMs: 31 * 60_000 },
      { mode: 'guided', attempts: 1, bestScore: 55, totalMs: 600_000 },
    ]);
  });

  it('formats durations', () => {
    expect(formatDuration(40_000)).toBe('40 s');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min');
  });
});
