/**
 * Drives the mode controllers from the stores: enters the board's mode when a board opens or its
 * mode/problem changes, forwards graph edits, simulation results, clock ticks and panel actions to
 * the controller's pure hooks, and records progress attempts (on completion, or when a session of
 * at least MIN_ATTEMPT_MS ends unfinished).
 */
import type { Registry } from '@/registry';
import type { BoardStore, SimResult, SimulationStore, WorkspaceStore } from '@/store';
import type { ModeSession, ModeStore } from './mode-store';
import { MIN_ATTEMPT_MS, type ProgressStore } from './progress';
import type { ModeRegistry } from './registry';
import type { AnyModeController, ModeAction, ModeContext, ModeSubject } from './types';

export interface ModeRunnerDeps {
  workspaceStore: WorkspaceStore;
  boardStore: BoardStore;
  simulationStore: SimulationStore;
  modeStore: ModeStore;
  progressStore: ProgressStore;
  registry: Registry;
  modes: ModeRegistry;
  /** Simulates a design (the engine worker in the app). Used for reference costs. */
  run?: (input: {
    graph: ModeContext['graph'];
    scenario: ModeContext['scenario'];
    providerId?: string;
  }) => Promise<SimResult>;
  now?: () => number;
  /** Clock tick for timed modes, ms (0 disables the interval; tests call `tick()`). */
  tickMs?: number;
  newAttemptId?: () => string;
}

export interface ModeRunner {
  /** Send a panel action (also installed as the mode store's `act`). */
  act(action: ModeAction): void;
  tick(): void;
  dispose(): void;
}

interface Attempt {
  id: string;
  subject: ModeSubject;
  startedAtMs: number;
  recorded: boolean;
}

const subjectKey = (s: ModeSubject | undefined) => (s ? `${s.kind}:${s.id}` : '');

export function startModeRunner(deps: ModeRunnerDeps): ModeRunner {
  const { workspaceStore, boardStore, simulationStore, modeStore, progressStore, registry } = deps;
  const now = deps.now ?? (() => Date.now());
  let counter = 0;
  const newAttemptId =
    deps.newAttemptId ?? (() => `att_${now().toString(36)}_${(++counter).toString(36)}`);
  let controller: AnyModeController | undefined;
  let attempt: Attempt | undefined;
  let referenceAsked = false;
  let disposed = false;

  function context(): ModeContext | undefined {
    const ws = workspaceStore.getState();
    const board = ws.data.boards[ws.activeBoardId];
    if (!board) return undefined;
    const { doc } = boardStore.getState();
    const sim = simulationStore.getState();
    return {
      boardId: board.id,
      graph: doc.graph,
      scenario: doc.scenario,
      problem: board.problemId ? registry.get(board.problemId, 'problem') : undefined,
      result: sim.boardId === board.id ? sim.result : null,
      registry,
      nowMs: now(),
    };
  }

  function defaultSubject(ctx: ModeContext): ModeSubject | undefined {
    return ctx.problem
      ? { kind: 'problem', id: ctx.problem.id, title: ctx.problem.title }
      : undefined;
  }

  function record(a: Attempt, session: ModeSession, completed: boolean, score?: number) {
    const durationMs = Math.max(0, now() - a.startedAtMs);
    if (!completed && durationMs < MIN_ATTEMPT_MS) return;
    progressStore.getState().record({
      id: a.id,
      subjectKind: a.subject.kind,
      subjectId: a.subject.id,
      title: a.subject.title,
      mode: session.modeId,
      boardId: session.boardId,
      startedAt: new Date(a.startedAtMs).toISOString(),
      durationMs,
      completed,
      ...(score !== undefined ? { score: Math.round(Math.max(0, Math.min(100, score))) } : {}),
    });
    a.recorded = true;
  }

  /** Close the running attempt (leaving the mode, board or subject). */
  function closeAttempt(session: ModeSession | null) {
    if (attempt && session && !attempt.recorded) record(attempt, session, false, undefined);
    attempt = undefined;
  }

  /** Store a new controller state and do the bookkeeping that follows from it. */
  function commit(state: unknown, ctx: ModeContext, base: ModeSession | null) {
    if (!controller) return;
    const c = controller;
    const complete = c.isComplete(state, ctx);
    const score = c.score?.(state, ctx);
    const subject = c.subject ? c.subject(state, ctx) : defaultSubject(ctx);
    const session: ModeSession = {
      boardId: ctx.boardId,
      modeId: c.id,
      problemId: ctx.problem?.id,
      state,
      complete,
      score,
      subject,
      version: (base?.version ?? 0) + 1,
      atMs: ctx.nowMs,
    };
    if (subjectKey(subject) !== subjectKey(attempt?.subject)) {
      closeAttempt(base);
      if (subject)
        attempt = { id: newAttemptId(), subject, startedAtMs: ctx.nowMs, recorded: false };
    }
    if (complete && !(base?.complete ?? false) && attempt && !attempt.recorded) {
      record(attempt, session, true, score);
    }
    modeStore.setState({ session });

    if (!referenceAsked && c.needsReferenceCost?.(state) && deps.run && ctx.problem) {
      referenceAsked = true;
      const ref = ctx.problem.referenceSolutions[0];
      const boardId = ctx.boardId;
      const providerId = workspaceStore.getState().data.boards[boardId]?.providerId;
      if (ref) {
        deps
          .run({
            graph: ref,
            scenario: ctx.problem.scenario,
            ...(providerId ? { providerId } : {}),
          })
          .then((r) => {
            const s = modeStore.getState().session;
            if (!disposed && s && s.boardId === boardId && s.modeId === c.id)
              act({ type: 'referenceCost', costPerMonth: r.system.costPerMonth });
          })
          .catch(() => {
            /* the scorecard simply has no cost part */
          });
      }
    }
  }

  function update(fn: (c: AnyModeController, state: unknown, ctx: ModeContext) => unknown) {
    const session = modeStore.getState().session;
    const ctx = context();
    if (!controller || !session || !ctx || ctx.boardId !== session.boardId) return;
    const next = fn(controller, session.state, ctx);
    if (next !== session.state) commit(next, ctx, session);
  }

  function act(action: ModeAction) {
    update((c, s, ctx) => (c.onAction ? c.onAction(s, action, ctx) : s));
  }

  /** Enter the open board's mode if the board, its mode or its problem changed. */
  function sync() {
    const ctx = context();
    const ws = workspaceStore.getState();
    const board = ws.data.boards[ws.activeBoardId];
    const session = modeStore.getState().session;
    if (!ctx || !board) {
      closeAttempt(session);
      controller = undefined;
      modeStore.setState({ session: null });
      return;
    }
    if (
      session &&
      session.boardId === board.id &&
      session.modeId === board.mode &&
      session.problemId === board.problemId
    )
      return;
    closeAttempt(session);
    referenceAsked = false;
    controller = deps.modes.get(board.mode) ?? deps.modes.get('sandbox');
    if (!controller) return;
    const state = controller.onEnter(ctx);
    commit(state, ctx, null);
    // Fresh numbers for the new session (Debug waits for a result of the current graph).
    simulationStore.getState().requestRun();
  }

  const unsubs = [
    workspaceStore.subscribe((next, prev) => {
      if (next.activeBoardId !== prev.activeBoardId || next.data !== prev.data) sync();
    }),
    boardStore.subscribe((next, prev) => {
      if (next.doc.graph === prev.doc.graph && next.doc.scenario === prev.doc.scenario) return;
      update((c, s, ctx) => c.onGraphChange(s, ctx));
    }),
    simulationStore.subscribe((next, prev) => {
      if (next.result === prev.result || next.result === null) return;
      update((c, s, ctx) => c.onSimResult(s, ctx));
    }),
  ];

  function tick() {
    update((c, s, ctx) => (c.onTick ? c.onTick(s, ctx) : s));
  }
  const tickMs = deps.tickMs ?? 1000;
  const timer = tickMs > 0 ? setInterval(tick, tickMs) : undefined;

  modeStore.setState({ act });
  sync();

  return {
    act,
    tick,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearInterval(timer);
      for (const u of unsubs) u();
      closeAttempt(modeStore.getState().session);
      modeStore.setState({ session: null, act: () => {} });
    },
  };
}
