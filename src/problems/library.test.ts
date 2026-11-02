/** S17: problem library logic — filtering, facets, formatting, modes and starting a problem. */
import { beforeEach, describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { createAppStores, type BoardStore, type WorkspaceStore } from '@/store';
import {
  blankScenario,
  companyStyles,
  filterProblems,
  findProblem,
  formatBytes,
  formatCount,
  formatReadWrite,
  hintsAllowed,
  listProblems,
  loadReferenceSolution,
  modeOptions,
  presetPeakRps,
  problemBoard,
  problemFacets,
  rubricLines,
  startProblem,
  topicTags,
  type Problem,
} from './index';

const all = listProblems(registry);
const get = (id: string) => findProblem(registry, id) as Problem;

let board: BoardStore;
let ws: WorkspaceStore;
beforeEach(() => {
  let i = 0;
  const s = createAppStores({ newId: (k) => `${k === 'group' ? 'grp' : k}_${++i}` });
  board = s.boardStore;
  ws = s.workspaceStore;
});

describe('listing and filtering', () => {
  it('lists every registry problem, easiest first', () => {
    expect(all).toHaveLength(13); // 10 problems + S22, S23 and S24 sample boards
    expect(all.map((p) => p.level)).toEqual([...all.map((p) => p.level)].sort((a, b) => a - b));
    expect(all[0]?.level).toBe(1);
    expect(findProblem(registry, undefined)).toBeUndefined();
    expect(findProblem(registry, 'problem.nope')).toBeUndefined();
  });

  it('separates company styles from topic tags', () => {
    const chat = get('problem.chat');
    expect(companyStyles(chat)).toEqual(['meta', 'discord']);
    expect(topicTags(chat)).toContain('websocket');
    expect(topicTags(chat).some((t) => t.startsWith('company:'))).toBe(false);
  });

  it('filters by level, tag, company and free text (all must match)', () => {
    expect(filterProblems(all, { level: 5 }).map((p) => p.id)).toEqual([
      'problem.payment-system',
      'problem.uber',
    ]);
    expect(
      filterProblems(all, { company: 'meta' })
        .map((p) => p.id)
        .sort(),
    ).toEqual(['problem.chat', 'problem.instagram', 'problem.news-feed']);
    expect(filterProblems(all, { company: 'meta', level: 4 }).map((p) => p.id)).toEqual([
      'problem.instagram',
    ]);
    expect(
      filterProblems(all, { tag: 'websocket' })
        .map((p) => p.id)
        .sort(),
    ).toEqual(['problem.chat', 'problem.uber']);
    expect(filterProblems(all, { query: 'TWITTER timeline' }).map((p) => p.id)).toEqual([
      'problem.news-feed',
    ]);
    // Company names match by label too ("Stripe" → stripe-style problems).
    expect(
      filterProblems(all, { query: 'stripe' })
        .map((p) => p.id)
        .sort(),
    ).toEqual(['problem.payment-system', 'problem.rate-limiter']);
    expect(filterProblems(all, { level: 1, tag: 'video' })).toEqual([]);
    expect(filterProblems(all, {})).toHaveLength(13);
  });

  it('computes facets with counts', () => {
    const f = problemFacets(all);
    expect(f.levels).toEqual([1, 2, 3, 4, 5]);
    expect(f.companies.find((c) => c.id === 'meta')).toEqual({
      id: 'meta',
      label: 'Meta',
      count: 3,
    });
    expect(f.companies.find((c) => c.id === 'x')?.label).toBe('X (Twitter)');
    const cdn = f.tags.find((t) => t.tag === 'cdn');
    expect(cdn?.count).toBe(3); // pastebin, instagram, youtube
    // Most common first.
    expect(f.tags[0]!.count).toBeGreaterThanOrEqual(f.tags[f.tags.length - 1]!.count);
  });
});

describe('formatting', () => {
  it('formats counts, bytes and ratios', () => {
    expect(formatCount(500_000_000)).toBe('500M');
    expect(formatCount(1_500)).toBe('1.5k');
    expect(formatCount(2_000_000_000)).toBe('2B');
    expect(formatCount(12)).toBe('12');
    expect(formatBytes(3e12)).toBe('3 TB');
    expect(formatBytes(1.5e15)).toBe('1.5 PB');
    expect(formatBytes(800)).toBe('800 B');
    expect(formatReadWrite(100)).toBe('100 : 1 reads : writes');
    expect(formatReadWrite(0.2)).toBe('1 : 5 reads : writes');
  });

  it('computes the preset peak load by hand', () => {
    // URL shortener: (600k + 300k) users × 0.017 rps × (0.99 + 0.01) × peak 2 = 30,600 rps.
    expect(presetPeakRps(get('problem.url-shortener').scenario)).toBeCloseTo(30_600, 6);
  });

  it('describes rubric lines with flow names', () => {
    const lines = rubricLines(get('problem.url-shortener'));
    expect(lines[0]).toEqual({ text: 'p99 < 200 ms (Redirect)', weight: 3 });
    expect(lines).toContainEqual({ text: 'availability ≥ 99.9%', weight: 2 });
    expect(lines).toContainEqual({ text: 'passes no-rate-limit-public-api', weight: 1 });
  });
});

describe('modes and boards', () => {
  it('offers five modes; Debug needs a broken variant; Interview starts blank only', () => {
    const opts = modeOptions(get('problem.news-feed'));
    expect(opts.map((m) => m.id)).toEqual(['guided', 'interview', 'sandbox', 'debug', 'chaos']);
    expect(opts.find((m) => m.id === 'debug')?.disabledReason).toMatch(/no broken variant/i);
    // S18: problems that ship a broken variant can start in Debug.
    expect(
      modeOptions(get('problem.chat')).find((m) => m.id === 'debug')?.disabledReason,
    ).toBeUndefined();
    expect(opts.find((m) => m.id === 'interview')?.starts).toEqual(['blank']);
    expect(opts.find((m) => m.id === 'chaos')?.starts[0]).toBe('reference');
    expect(hintsAllowed('interview')).toBe(false);
    expect(hintsAllowed('guided')).toBe(true);
  });

  it('a blank start keeps users and load but clears flow paths', () => {
    const p = get('problem.news-feed');
    const s = blankScenario(p.scenario);
    expect(s.usersByRegion).toEqual(p.scenario.usersByRegion);
    expect(s.flows.map((f) => f.name)).toEqual(p.scenario.flows.map((f) => f.name));
    expect(s.flows.every((f) => f.path.length === 0)).toBe(true);
    expect(p.scenario.flows[0]!.path.length).toBeGreaterThan(0); // preset untouched
  });

  it('builds a board for each start', () => {
    const p = get('problem.uber');
    const blank = problemBoard(p, { mode: 'interview', start: 'blank' }, 'proj_1').board;
    expect(blank).toMatchObject({
      id: 'board_uber-interview',
      projectId: 'proj_1',
      name: 'Uber · Interview',
      mode: 'interview',
      problemId: 'problem.uber',
      providerId: 'generic',
      graph: { nodes: [], edges: [], groups: [] },
    });
    const ref = problemBoard(p, { mode: 'chaos', start: 'reference' }, 'proj_1').board;
    expect(ref.graph).toEqual(p.referenceSolutions[0]);
    expect(ref.graph).not.toBe(p.referenceSolutions[0]);
    expect(ref.scenario).toEqual(p.scenario);
    expect(() => problemBoard(p, { mode: 'interview', start: 'reference' }, 'proj_1')).toThrow(
      /cannot start from/,
    );
    expect(() => problemBoard(p, { mode: 'debug', start: 'debug' }, 'proj_1')).toThrow(
      /no broken variant/i,
    );
    expect(() => problemBoard(p, { mode: 'learn', start: 'blank' }, 'proj_1')).toThrow(
      /not available/,
    );
  });
});

describe('starting a problem', () => {
  it('adds a board to the active project, opens it and keeps mode, problem and scenario', () => {
    const before = ws.getState();
    const project = before.data.projects[0]!;
    const res = startProblem(ws, get('problem.rate-limiter'), { mode: 'guided', start: 'blank' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const st = ws.getState();
    expect(st.activeBoardId).toBe(res.boardId);
    expect(st.data.projects[0]!.boardIds).toEqual([...project.boardIds, res.boardId]);
    const b = st.data.boards[res.boardId]!;
    expect(b).toMatchObject({
      mode: 'guided',
      problemId: 'problem.rate-limiter',
      name: 'Rate limiter · Guided',
    });
    expect(board.getState().doc.scenario.usersByRegion).toEqual({
      'north-america': 200_000,
      europe: 50_000,
    });
    expect(board.getState().doc.graph.nodes).toEqual([]);

    // Starting the same again gets a fresh id and a unique name.
    const again = startProblem(ws, get('problem.rate-limiter'), { mode: 'guided', start: 'blank' });
    expect(again.ok && again.boardId).not.toBe(res.boardId);
    if (again.ok)
      expect(ws.getState().data.boards[again.boardId]!.name).toBe('Rate limiter · Guided 2');
  });

  it('a reference start loads the design onto the board', () => {
    const p = get('problem.instagram');
    const res = startProblem(ws, p, { mode: 'sandbox', start: 'reference' });
    expect(res.ok).toBe(true);
    expect(board.getState().doc.graph.nodes.map((n) => n.id)).toEqual(
      p.referenceSolutions[0]!.nodes.map((n) => n.id),
    );
    expect(board.getState().doc.scenario.flows).toEqual(p.scenario.flows);
  });

  it('reports a reason instead of throwing for an impossible start', () => {
    const res = startProblem(ws, get('problem.news-feed'), { mode: 'debug', start: 'debug' });
    expect(res).toEqual({ ok: false, reason: expect.stringMatching(/no broken variant/i) });
  });

  it('loads the reference solution on the open board as one undo step', () => {
    const p = get('problem.pastebin');
    startProblem(ws, p, { mode: 'guided', start: 'blank' });
    board.getState().dispatch({
      type: 'addNode',
      defId: 'compute.app-server',
      position: { x: 0, y: 0 },
    });
    const mine = board.getState().doc.graph.nodes.length;
    expect(loadReferenceSolution(board, p)).toEqual({ ok: true });
    expect(board.getState().doc.graph.nodes).toHaveLength(p.referenceSolutions[0]!.nodes.length);
    expect(board.getState().doc.scenario.flows[0]!.path.length).toBeGreaterThan(0);
    board.getState().undo();
    expect(board.getState().doc.graph.nodes).toHaveLength(mine);
    expect(board.getState().doc.scenario.flows.every((f) => f.path.length === 0)).toBe(true);
  });
});
