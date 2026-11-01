/** S18 mode runner: enter on board/mode change, hooks, actions, ticks and progress records. */
import { beforeEach, describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import {
  createAppStores,
  createSimulationStore,
  type BoardStore,
  type SimulationStore,
  type WorkspaceStore,
} from '@/store';
import { loadDebugCase, setBoardMode, attachProblem } from './board-actions';
import { debugCases } from './debug';
import { createModeStore, type ModeStore } from './mode-store';
import { createProgressStore, memoryProgressStorage, type ProgressStore } from './progress';
import { modes } from './registry';
import { startModeRunner, type ModeRunner } from './runner';
import { simulateBoard, problem } from './test-utils';
import type { InterviewState } from './interview';

let ws: WorkspaceStore;
let board: BoardStore;
let sim: SimulationStore;
let modeStore: ModeStore;
let progress: ProgressStore;
let runner: ModeRunner;
let clock: number;

/** What the app's simulation runner does: simulate the open board into the store. */
function simulateNow() {
  const doc = board.getState().doc;
  const id = sim.getState().start();
  sim.getState().finish(id, ws.getState().activeBoardId, simulateBoard(doc.graph, doc.scenario));
}

beforeEach(() => {
  let i = 0;
  const s = createAppStores({ newId: (k) => `${k === 'group' ? 'grp' : k}_${++i}` });
  ws = s.workspaceStore;
  board = s.boardStore;
  sim = createSimulationStore();
  modeStore = createModeStore();
  progress = createProgressStore(memoryProgressStorage());
  clock = Date.parse('2026-11-01T10:00:00Z');
  runner = startModeRunner({
    workspaceStore: ws,
    boardStore: board,
    simulationStore: sim,
    modeStore,
    progressStore: progress,
    registry,
    modes,
    now: () => clock,
    tickMs: 0,
    run: async (input) => simulateBoard(input.graph, input.scenario),
  });
  return () => runner.dispose();
});

const session = () => modeStore.getState().session!;

describe('mode registry', () => {
  it('discovers the six modes in order', () => {
    expect(modes.list().map((m) => m.id)).toEqual([
      'sandbox',
      'guided',
      'interview',
      'debug',
      'chaos',
      'learn',
    ]);
  });
});

describe('mode runner', () => {
  it('enters the board’s mode, and every mode can be entered on any board', () => {
    expect(session().modeId).toBe('sandbox');
    const runs = sim.getState().runRequests;
    for (const m of modes.list()) {
      expect(setBoardMode(ws, m.id).ok).toBe(true);
      expect(session().modeId).toBe(m.id);
      expect(ws.getState().data.boards[ws.getState().activeBoardId]!.mode).toBe(m.id);
    }
    expect(sim.getState().runRequests).toBeGreaterThan(runs);
  });

  it('switching boards re-enters; switching back starts a fresh session', () => {
    setBoardMode(ws, 'guided');
    const first = ws.getState().activeBoardId;
    const res = ws.getState().createBoard();
    if (!res.ok) throw new Error(res.reason);
    expect(session().modeId).toBe('sandbox');
    ws.getState().openBoard(first);
    expect(session()).toMatchObject({ modeId: 'guided', boardId: first });
  });

  it('Interview: attach a problem, tick, finish → scorecard with reference cost → progress record', async () => {
    setBoardMode(ws, 'interview');
    const p = problem('problem.url-shortener');
    expect(attachProblem(ws, board, p).ok).toBe(true);
    expect(session().problemId).toBe(p.id);
    expect((session().state as InterviewState).startedAtMs).toBe(clock);
    clock += 16 * 60_000;
    runner.tick();
    expect((session().state as InterviewState).asked).toEqual(['scope', 'read-path']);
    runner.act({ type: 'finish' });
    expect(session().complete).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    const card = (session().state as InterviewState).scorecard!;
    expect(card.referenceCostPerMonth).toBeGreaterThan(0);
    const [att] = progress.getState().attempts;
    expect(att).toMatchObject({
      subjectId: p.id,
      mode: 'interview',
      completed: true,
      durationMs: 16 * 60_000,
    });
  });

  it('Debug: load a broken design, see it broken, fix it → completed attempt', () => {
    setBoardMode(ws, 'debug');
    const c = debugCases(registry).find((x) => x.variant.id === 'plaintext-gateway')!;
    expect(loadDebugCase(ws, board, c).ok).toBe(true);
    expect(session().state).toMatchObject({
      problemId: c.problem.id,
      variantId: c.variant.id,
      stale: true,
    });
    simulateNow();
    expect(session().state).toMatchObject({ sawBroken: true });
    expect(session().complete).toBe(false);
    const res = board.getState().dispatch({
      type: 'updateEdge',
      edgeId: 'edge_client-gw',
      protocolStack: ['tcp', 'tls13', 'http2'],
    });
    expect(res.ok).toBe(true);
    clock += 120_000;
    simulateNow();
    expect(session().complete).toBe(true);
    expect(progress.getState().attempts).toEqual([
      expect.objectContaining({
        subjectId: c.problem.id,
        mode: 'debug',
        completed: true,
        score: 100,
      }),
    ]);
  });

  it('records unfinished sessions of at least 10 s when leaving, and ignores shorter ones', () => {
    setBoardMode(ws, 'guided');
    attachProblem(ws, board, problem('problem.rate-limiter'));
    clock += 5_000;
    setBoardMode(ws, 'sandbox');
    expect(progress.getState().attempts).toHaveLength(0);
    setBoardMode(ws, 'guided');
    clock += 60_000;
    setBoardMode(ws, 'chaos');
    expect(progress.getState().attempts).toEqual([
      expect.objectContaining({ mode: 'guided', completed: false, durationMs: 60_000 }),
    ]);
  });

  it('Learn: the attempt follows the lesson that is open', () => {
    setBoardMode(ws, 'learn');
    expect(session().subject).toBeUndefined();
    runner.act({ type: 'open', lessonId: 'lesson.cache-aside' });
    expect(session().subject).toMatchObject({ kind: 'lesson', id: 'lesson.cache-aside' });
    const l = registry.require('lesson.cache-aside', 'lesson');
    l.quiz.forEach((q, i) => runner.act({ type: 'answer', question: i, option: q.answerIndex }));
    runner.act({ type: 'submit' });
    expect(session().complete).toBe(true);
    expect(progress.getState().attempts[0]).toMatchObject({
      subjectKind: 'lesson',
      score: 100,
      completed: true,
    });
  });
});
