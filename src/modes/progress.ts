/**
 * Local progress (MODES.md: "scores, attempts and time per problem are stored locally"). A small
 * versioned JSON document in localStorage, separate from the workspace file, with forward
 * migrations like every saved format. One record per attempt (a mode session on a problem or a
 * lesson); the progress page aggregates them.
 */
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';

export const PROGRESS_SCHEMA_VERSION = 1;
export const PROGRESS_STORAGE_KEY = 'sysdraw.progress';
/** Sessions shorter than this that did not finish are not counted as attempts. */
export const MIN_ATTEMPT_MS = 10_000;

export const AttemptSchema = z.object({
  id: z.string().min(1),
  subjectKind: z.enum(['problem', 'lesson']),
  subjectId: z.string().min(1),
  title: z.string().min(1),
  mode: z.string().min(1),
  boardId: z.string(),
  startedAt: z.string().min(1),
  durationMs: z.number().nonnegative(),
  completed: z.boolean(),
  score: z.number().min(0).max(100).optional(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const ProgressFileSchema = z.object({
  schemaVersion: z.literal(PROGRESS_SCHEMA_VERSION),
  attempts: z.array(AttemptSchema),
});
export type ProgressFile = z.infer<typeof ProgressFileSchema>;

/** `from version n` → version n + 1. Empty today; add one per format change. */
export const PROGRESS_MIGRATIONS: Record<
  number,
  (doc: Record<string, unknown>) => Record<string, unknown>
> = {};

export const emptyProgress = (): ProgressFile => ({
  schemaVersion: PROGRESS_SCHEMA_VERSION,
  attempts: [],
});

export type LoadOutcome = { file: ProgressFile; warning?: string };

/** Parse + migrate a stored document; anything unreadable starts fresh with a warning. */
export function parseProgress(text: string | null): LoadOutcome {
  if (text === null || text === '') return { file: emptyProgress() };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { file: emptyProgress(), warning: 'Saved progress was not valid JSON; starting fresh.' };
  }
  if (typeof doc !== 'object' || doc === null)
    return {
      file: emptyProgress(),
      warning: 'Saved progress had an unknown shape; starting fresh.',
    };
  let cur = doc as Record<string, unknown>;
  let v = typeof cur.schemaVersion === 'number' ? cur.schemaVersion : 0;
  if (v > PROGRESS_SCHEMA_VERSION)
    return {
      file: emptyProgress(),
      warning: `Saved progress is from a newer version (${v}); it was not loaded.`,
    };
  while (v < PROGRESS_SCHEMA_VERSION) {
    const step = PROGRESS_MIGRATIONS[v];
    if (!step)
      return { file: emptyProgress(), warning: `No migration from progress version ${v}.` };
    cur = { ...step(cur), schemaVersion: v + 1 };
    v += 1;
  }
  const parsed = ProgressFileSchema.safeParse(cur);
  if (!parsed.success)
    return { file: emptyProgress(), warning: 'Saved progress failed validation; starting fresh.' };
  return { file: parsed.data };
}

export interface ProgressStorage {
  load(): string | null;
  save(text: string): void;
}

/** localStorage when available (else in memory); errors (quota, privacy mode) are ignored. */
export function browserProgressStorage(key = PROGRESS_STORAGE_KEY): ProgressStorage {
  let memory: string | null = null;
  const ls = () => {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage;
    } catch {
      return undefined;
    }
  };
  return {
    load() {
      try {
        return ls()?.getItem(key) ?? memory;
      } catch {
        return memory;
      }
    },
    save(text) {
      memory = text;
      try {
        ls()?.setItem(key, text);
      } catch {
        /* keep the in-memory copy */
      }
    },
  };
}

export function memoryProgressStorage(initial: string | null = null): ProgressStorage {
  let text = initial;
  return { load: () => text, save: (t) => void (text = t) };
}

export interface ProgressState {
  attempts: Attempt[];
  warning: string | null;
  /** Insert or replace by id. */
  record(attempt: Attempt): void;
  clear(): void;
}
export type ProgressStore = StoreApi<ProgressState>;

export function createProgressStore(
  storage: ProgressStorage = browserProgressStorage(),
): ProgressStore {
  const { file, warning } = parseProgress(storage.load());
  const persist = (attempts: Attempt[]) =>
    storage.save(JSON.stringify({ schemaVersion: PROGRESS_SCHEMA_VERSION, attempts }));
  return createStore<ProgressState>()((set, get) => ({
    attempts: file.attempts,
    warning: warning ?? null,
    record(attempt) {
      const valid = AttemptSchema.parse(attempt);
      const rest = get().attempts.filter((a) => a.id !== valid.id);
      const attempts = [...rest, valid];
      persist(attempts);
      set({ attempts });
    },
    clear() {
      persist([]);
      set({ attempts: [] });
    },
  }));
}

// ---------- summaries ----------

export interface SubjectProgress {
  subjectKind: Attempt['subjectKind'];
  subjectId: string;
  title: string;
  attempts: number;
  completed: number;
  bestScore: number | undefined;
  lastScore: number | undefined;
  totalMs: number;
  lastAt: string;
  byMode: { mode: string; attempts: number; bestScore: number | undefined; totalMs: number }[];
}

const best = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? Math.max(...v) : undefined;
};

/** One row per problem / lesson, most recently practised first. */
export function progressSummary(attempts: readonly Attempt[]): SubjectProgress[] {
  const groups = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const k = `${a.subjectKind}:${a.subjectId}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const last = sorted[sorted.length - 1]!;
      const modesSeen = [...new Set(sorted.map((a) => a.mode))];
      return {
        subjectKind: last.subjectKind,
        subjectId: last.subjectId,
        title: last.title,
        attempts: sorted.length,
        completed: sorted.filter((a) => a.completed).length,
        bestScore: best(sorted.map((a) => a.score)),
        lastScore: [...sorted].reverse().find((a) => a.score !== undefined)?.score,
        totalMs: sorted.reduce((s, a) => s + a.durationMs, 0),
        lastAt: last.startedAt,
        byMode: modesSeen.map((mode) => {
          const m = sorted.filter((a) => a.mode === mode);
          return {
            mode,
            attempts: m.length,
            bestScore: best(m.map((a) => a.score)),
            totalMs: m.reduce((s, a) => s + a.durationMs, 0),
          };
        }),
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** "1 h 05 min", "12 min", "40 s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
