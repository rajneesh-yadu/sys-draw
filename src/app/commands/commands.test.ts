import { describe, expect, it, vi } from 'vitest';
import { createReviewStore, createSecurityStore, createTraceStore, GRID } from '@/canvas';
import { registry } from '@/registry';
import { createAppStores, createSimulationStore } from '@/store';
import { createUiStore } from '../ui/ui-store';
import { buildCommands, placementForNewNode, rankCommands, type AppCommand } from './commands';
import { appShortcutFor, shortcutSheet } from './shortcuts';

function setup() {
  const { boardStore: board, workspaceStore: workspace } = createAppStores();
  const simulation = createSimulationStore();
  const ui = createUiStore({ storage: null });
  const trace = createTraceStore();
  const security = createSecurityStore();
  const review = createReviewStore();
  const notify = vi.fn();
  const build = () =>
    buildCommands({ board, workspace, simulation, ui, registry, trace, security, review, notify });
  return { board, workspace, simulation, ui, trace, security, review, notify, build };
}

const cmd = (list: AppCommand[], id: string) => {
  const c = list.find((x) => x.id === id);
  if (!c) throw new Error(`no command ${id}`);
  return c;
};

const fake = (title: string, extra: Partial<AppCommand> = {}): AppCommand => ({
  id: title,
  title,
  group: 'Board',
  run: () => {},
  ...extra,
});

describe('rankCommands (S21)', () => {
  const list = [
    fake('Add Postgres', { keywords: 'database sql' }),
    fake('Add Redis', { keywords: 'cache' }),
    fake('Toggle Projects and Palette'),
    fake('Undo', { disabledReason: 'Nothing to undo' }),
    fake('Run simulation'),
    fake('Add Redis Cluster', { disabledReason: 'x' }),
  ];
  const titles = (q: string) => rankCommands(list, q).map((c) => c.title);

  it('returns everything for an empty query, in order', () => {
    expect(titles('  ')).toEqual(list.map((c) => c.title));
  });

  it('ranks prefix < word start < substring < keyword match', () => {
    // "Add Postgres" only contains an "r" (substring rank) and comes after the word-start hits.
    expect(titles('add r')).toEqual(['Add Redis', 'Add Redis Cluster', 'Add Postgres']);
    expect(titles('redis')).toEqual(['Add Redis', 'Add Redis Cluster']);
    expect(titles('sql')).toEqual(['Add Postgres']);
    expect(titles('pal')).toEqual(['Toggle Projects and Palette']);
  });

  it('puts disabled commands after enabled ones of the same rank', () => {
    expect(titles('add redis')).toEqual(['Add Redis', 'Add Redis Cluster']);
  });

  it('falls back to fuzzy only when nothing matches directly', () => {
    expect(titles('pstgr')).toEqual(['Add Postgres']);
    // "redis" has direct matches, so fuzzy hits elsewhere are not added.
    expect(titles('redis')).not.toContain('Run simulation');
    expect(titles('zzz')).toEqual([]);
  });
});

describe('buildCommands (S21)', () => {
  it('has one "Add" command per palette component of the board provider', () => {
    const { build, board } = setup();
    const adds = build().filter((c) => c.group === 'Add component');
    const expected = registry.list({
      kind: 'component',
      provider: board.getState().doc.providerId,
    });
    expect(adds).toHaveLength(expected.length);
    expect(adds.map((c) => c.title)).toContain('Add Redis');
  });

  it('"Add Redis" adds, selects and focuses the node next to the others', () => {
    const { build, board, simulation } = setup();
    board
      .getState()
      .dispatch({ type: 'addNode', defId: 'client.app', position: { x: 100, y: 40 } });
    cmd(build(), 'add.cache.redis').run();
    const nodes = board.getState().doc.graph.nodes;
    const redis = nodes.find((n) => n.defId === 'cache.redis');
    expect(redis?.position).toEqual(placementForNewNode({ nodes: nodes.slice(0, 1) }));
    expect(board.getState().selection).toEqual([redis?.id]);
    expect(simulation.getState().focus?.nodeId).toBe(redis?.id);
  });

  it('disables undo/redo/delete when there is nothing to do', () => {
    const { build, board } = setup();
    let list = build();
    expect(cmd(list, 'board.undo').disabledReason).toBe('Nothing to undo');
    expect(cmd(list, 'board.delete-selection').disabledReason).toBe('Nothing selected');
    board.getState().dispatch({ type: 'addNode', defId: 'client.app', position: { x: 0, y: 0 } });
    list = build();
    expect(cmd(list, 'board.undo').disabledReason).toBeUndefined();
    cmd(list, 'board.undo').run();
    expect(board.getState().doc.graph.nodes).toHaveLength(0);
  });

  it('lists the other boards to go to, and opens them', () => {
    const { build, workspace } = setup();
    const first = workspace.getState().activeBoardId;
    workspace.getState().createBoard(undefined, 'Write path');
    const gotos = build().filter((c) => c.group === 'Go to board');
    expect(gotos.map((c) => c.title)).toEqual([expect.stringMatching(/\/ Board 1$/)]);
    gotos[0]?.run();
    expect(workspace.getState().activeBoardId).toBe(first);
  });

  it('switches theme, panels and overlays', () => {
    const { build, ui, trace, review } = setup();
    cmd(build(), 'view.theme.dark').run();
    expect(ui.getState().prefs.theme).toBe('dark');
    expect(cmd(build(), 'view.theme.dark').title).toBe('Theme: Dark (current)');
    cmd(build(), 'panels.left').run();
    expect(ui.getState().prefs).toMatchObject({ projectsCollapsed: true, paletteCollapsed: true });
    expect(cmd(build(), 'panels.palette').title).toBe('Expand Palette panel');
    cmd(build(), 'panels.metrics').run();
    expect(ui.getState().prefs.metricsMaximized).toBe(true);
    cmd(build(), 'panel.trace').run();
    expect(trace.getState().open).toBe(true);
    expect(cmd(build(), 'panel.trace').title).toBe('Close request trace');
    cmd(build(), 'panel.review').run();
    expect(review.getState().open).toBe(true);
    cmd(build(), 'view.shortcuts').run();
    expect(ui.getState().shortcutsOpen).toBe(true);
  });

  it('S24: collapses the Inspector, hides the minimap, expands the trace (opening it)', () => {
    const { build, ui, trace } = setup();
    expect(cmd(build(), 'panels.inspector').title).toBe('Collapse Inspector panel');
    cmd(build(), 'panels.inspector').run();
    expect(ui.getState().prefs.inspectorCollapsed).toBe(true);
    expect(cmd(build(), 'panels.inspector').title).toBe('Expand Inspector panel');
    expect(cmd(build(), 'panels.minimap').title).toBe('Hide minimap');
    cmd(build(), 'panels.minimap').run();
    expect(ui.getState().prefs.minimapVisible).toBe(false);
    expect(cmd(build(), 'panels.minimap').title).toBe('Show minimap');
    expect(trace.getState().open).toBe(false);
    cmd(build(), 'panels.trace-width').run();
    expect(ui.getState().prefs.traceExpanded).toBe(true);
    expect(trace.getState().open).toBe(true);
    expect(cmd(build(), 'panels.trace-width').title).toBe('Restore Request trace width');
    cmd(build(), 'panels.trace-width').run();
    expect(ui.getState().prefs.traceExpanded).toBe(false);
    expect(trace.getState().open).toBe(true); // restoring the width doesn't close it
  });

  it('runs the simulation and loads the perf board', () => {
    const { build, simulation, board, notify } = setup();
    const before = simulation.getState().runRequests;
    cmd(build(), 'sim.run').run();
    expect(simulation.getState().runRequests).toBe(before + 1);
    cmd(build(), 'dev.perf-fixture').run();
    expect(board.getState().doc.graph.nodes).toHaveLength(300);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('300 nodes'));
  });
});

describe('placementForNewNode', () => {
  const n = (x: number, y: number, groupId?: string) => ({
    id: 'node_x',
    defId: 'client.app',
    label: 'x',
    position: { x, y },
    config: {},
    scaling: { replicas: 1, instanceType: 'small' },
    ...(groupId ? { groupId } : {}),
  });
  it('is the origin on an empty board, else right of the top-level nodes on the grid', () => {
    expect(placementForNewNode({ nodes: [] })).toEqual({ x: 0, y: 0 });
    const p = placementForNewNode({ nodes: [n(0, 0), n(300, 100), n(900, 0, 'grp_a')] });
    expect(p.y).toBe(Math.round(50 / GRID) * GRID);
    expect(p.x).toBeGreaterThan(300);
    expect(p.x % GRID).toBe(0);
  });
});

describe('app shortcuts (S21)', () => {
  const key = (
    k: string,
    mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
  ) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });
  it('maps keys, and ignores the plain-key ones while typing', () => {
    expect(appShortcutFor(key('k', { ctrlKey: true }))).toBe('commandPalette');
    expect(appShortcutFor(key('K', { metaKey: true }))).toBe('commandPalette');
    expect(appShortcutFor(key('b', { ctrlKey: true }))).toBe('toggleLeftPanels');
    expect(appShortcutFor(key('s', { metaKey: true }))).toBe('save');
    expect(appShortcutFor(key('?', { shiftKey: true }))).toBe('shortcuts');
    expect(appShortcutFor(key('?', { shiftKey: true }), true)).toBeNull();
    expect(appShortcutFor(key('b', { ctrlKey: true }), true)).toBeNull();
    expect(appShortcutFor(key('k', { ctrlKey: true }), true)).toBe('commandPalette');
    expect(appShortcutFor(key('k', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(appShortcutFor(key('z', { ctrlKey: true }))).toBeNull();
  });

  it('the sheet lists app keys and every canvas shortcut', () => {
    const groups = shortcutSheet();
    expect(groups.map((g) => g.title)).toEqual(['General', 'Canvas', 'Panels']);
    const all = groups.flatMap((g) => g.rows.map((r) => r.label));
    for (const label of ['Undo', 'Redo', 'Delete selection', 'Ungroup', 'Save now']) {
      expect(all).toContain(label);
    }
    expect(groups.flatMap((g) => g.rows).every((r) => r.keys && r.label)).toBe(true);
  });
});
