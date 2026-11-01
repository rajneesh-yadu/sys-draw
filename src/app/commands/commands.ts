/**
 * S21: the command palette's commands. Commands are plain data built from the live stores and the
 * registry — one per action, one per palette component ("Add Redis"), one per board ("Go to …")
 * — so a new registry component or a new board shows up with no UI change.
 */
import { GRID, NODE_WIDTH, type ReviewStore, type SecurityStore, type TraceStore } from '@/canvas';
import { newId } from '@/core';
import type { Autosave } from '@/persistence';
import { componentDisplayName, type Registry } from '@/registry';
import type { BoardStore, Graph, SimulationStore, WorkspaceStore } from '@/store';
import { THEME_LABEL } from '../ui/theme';
import { THEME_PREFS, type UiStore } from '../ui/ui-store';
import { loadPerfFixture } from '../perf/fixture';
import { APP_SHORTCUT_KEYS } from './shortcuts';
import { SHORTCUT_HELP } from '@/canvas';

export const COMMAND_GROUPS = [
  'Board',
  'Simulation',
  'View',
  'Panels',
  'Go to board',
  'Add component',
  'Developer',
] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface AppCommand {
  id: string;
  title: string;
  group: CommandGroup;
  /** Extra search words (not shown). */
  keywords?: string;
  /** Shown on the right, e.g. "Ctrl/⌘+Z". */
  shortcut?: string;
  /** Why it can't run right now (shown, and the command is skipped on Enter). */
  disabledReason?: string;
  run(): void;
}

export interface CommandDeps {
  board: BoardStore;
  workspace: WorkspaceStore;
  simulation: SimulationStore;
  ui: UiStore;
  registry: Registry;
  trace?: TraceStore;
  security?: SecurityStore;
  review?: ReviewStore;
  autosave?: Autosave;
  /** Show a short message (the shell's notice line). */
  notify?: (text: string, kind?: 'info' | 'error') => void;
}

/**
 * Where "Add <component>" puts a node: right of the top-level nodes, level with their middle, on
 * the grid; (0, 0) on an empty board. The canvas then zooms to it (`requestFocus`).
 */
export function placementForNewNode(graph: Pick<Graph, 'nodes'>): { x: number; y: number } {
  const top = graph.nodes.filter((n) => n.groupId === undefined);
  const list = top.length > 0 ? top : graph.nodes;
  if (list.length === 0) return { x: 0, y: 0 };
  let maxX = -Infinity;
  let sumY = 0;
  for (const n of list) {
    maxX = Math.max(maxX, n.position.x);
    sumY += n.position.y;
  }
  const snap = (v: number) => Math.round(v / GRID) * GRID;
  return { x: snap(maxX + NODE_WIDTH + 4 * GRID), y: snap(sumY / list.length) };
}

export function buildCommands(deps: CommandDeps): AppCommand[] {
  const { board, workspace, simulation, ui, registry } = deps;
  const b = board.getState();
  const ws = workspace.getState();
  const u = ui.getState();
  const notify = deps.notify ?? (() => {});
  const report = (r: { ok: true } | { ok: false; reason: string }) => {
    if (!r.ok) notify(r.reason, 'error');
  };
  const hasSelection = b.selection.length > 0;
  const cmds: AppCommand[] = [];

  // Board
  cmds.push(
    {
      id: 'board.undo',
      title: 'Undo',
      group: 'Board',
      shortcut: SHORTCUT_HELP.undo,
      ...(b.past.length === 0 ? { disabledReason: 'Nothing to undo' } : {}),
      run: () => board.getState().undo(),
    },
    {
      id: 'board.redo',
      title: 'Redo',
      group: 'Board',
      shortcut: SHORTCUT_HELP.redo,
      ...(b.future.length === 0 ? { disabledReason: 'Nothing to redo' } : {}),
      run: () => board.getState().redo(),
    },
    {
      id: 'board.delete-selection',
      title: 'Delete selection',
      group: 'Board',
      keywords: 'remove',
      shortcut: SHORTCUT_HELP.delete,
      ...(!hasSelection ? { disabledReason: 'Nothing selected' } : {}),
      run: () => report(board.getState().deleteSelection()),
    },
    {
      id: 'board.clear-selection',
      title: 'Clear selection',
      group: 'Board',
      keywords: 'deselect',
      shortcut: SHORTCUT_HELP.clearSelection,
      ...(!hasSelection ? { disabledReason: 'Nothing selected' } : {}),
      run: () => board.getState().setSelection([]),
    },
    {
      id: 'board.new',
      title: 'New board',
      group: 'Board',
      keywords: 'tab page create',
      run: () => report(workspace.getState().createBoard()),
    },
    {
      id: 'board.duplicate',
      title: 'Duplicate this board',
      group: 'Board',
      keywords: 'copy clone tab',
      run: () => report(workspace.getState().duplicateBoard(workspace.getState().activeBoardId)),
    },
    {
      id: 'board.snapshot',
      title: 'Save a snapshot of this board',
      group: 'Board',
      keywords: 'version checkpoint',
      run: () => report(workspace.getState().saveSnapshot()),
    },
  );
  if (deps.autosave) {
    const autosave = deps.autosave;
    cmds.push({
      id: 'board.save',
      title: 'Save now',
      group: 'Board',
      shortcut: APP_SHORTCUT_KEYS.save,
      run: () => void autosave.flush(),
    });
  }

  // Simulation
  cmds.push({
    id: 'sim.run',
    title: 'Run simulation',
    group: 'Simulation',
    keywords: 'simulate refresh metrics',
    run: () => simulation.getState().requestRun(),
  });
  if (deps.trace) {
    const t = deps.trace;
    cmds.push({
      id: 'panel.trace',
      title: t.getState().open ? 'Close request trace' : 'Trace a request',
      group: 'Simulation',
      keywords: 'dns tcp tls handshake packet protocol',
      run: () => t.getState().setOpen(!t.getState().open),
    });
  }
  if (deps.security) {
    const s = deps.security;
    cmds.push({
      id: 'panel.security',
      title: s.getState().open ? 'Close security review' : 'Open security review',
      group: 'Simulation',
      keywords: 'threats zones encryption tls firewall',
      run: () => s.getState().setOpen(!s.getState().open),
    });
  }
  if (deps.review) {
    const r = deps.review;
    cmds.push({
      id: 'panel.review',
      title: r.getState().open ? 'Close design review' : 'Open design review',
      group: 'Simulation',
      keywords: 'findings rules spof bottleneck evaluate',
      run: () => r.getState().setOpen(!r.getState().open),
    });
  }

  // View
  for (const theme of THEME_PREFS) {
    cmds.push({
      id: `view.theme.${theme}`,
      title: `Theme: ${THEME_LABEL[theme]}${u.prefs.theme === theme ? ' (current)' : ''}`,
      group: 'View',
      keywords: 'dark light mode colour color appearance',
      run: () => ui.getState().setTheme(theme),
    });
  }
  cmds.push({
    id: 'view.shortcuts',
    title: 'Show keyboard shortcuts',
    group: 'View',
    keywords: 'help keys hotkeys',
    shortcut: APP_SHORTCUT_KEYS.shortcuts,
    run: () => ui.getState().setShortcutsOpen(true),
  });

  // Panels
  cmds.push(
    {
      id: 'panels.left',
      title: 'Toggle Projects and Palette',
      group: 'Panels',
      keywords: 'sidebar collapse expand hide show left',
      shortcut: APP_SHORTCUT_KEYS.toggleLeftPanels,
      run: () => ui.getState().toggleLeftPanels(),
    },
    {
      id: 'panels.projects',
      title: u.prefs.projectsCollapsed ? 'Expand Projects panel' : 'Collapse Projects panel',
      group: 'Panels',
      keywords: 'sidebar hide show left',
      run: () => ui.getState().setProjectsCollapsed(!ui.getState().prefs.projectsCollapsed),
    },
    {
      id: 'panels.palette',
      title: u.prefs.paletteCollapsed ? 'Expand Palette panel' : 'Collapse Palette panel',
      group: 'Panels',
      keywords: 'components sidebar hide show left',
      run: () => ui.getState().setPaletteCollapsed(!ui.getState().prefs.paletteCollapsed),
    },
    {
      id: 'panels.metrics',
      title: u.prefs.metricsMaximized ? 'Restore Metrics panel size' : 'Maximise Metrics panel',
      group: 'Panels',
      keywords: 'expand bigger failures over time chart drawer',
      run: () => ui.getState().setMetricsMaximized(!ui.getState().prefs.metricsMaximized),
    },
  );

  // Go to board
  for (const p of ws.data.projects) {
    for (const boardId of p.boardIds) {
      const bd = ws.data.boards[boardId];
      if (!bd || boardId === ws.activeBoardId) continue;
      cmds.push({
        id: `goto.${boardId}`,
        title: `${p.name} / ${bd.name}`,
        group: 'Go to board',
        keywords: 'open switch tab',
        run: () => report(workspace.getState().openBoard(boardId)),
      });
    }
  }

  // Add component (the board's provider names, provider-only components on their cloud only)
  const providerId = b.doc.providerId;
  for (const def of registry.list({ kind: 'component', provider: providerId })) {
    const name = componentDisplayName(def, providerId);
    cmds.push({
      id: `add.${def.id}`,
      title: `Add ${name}`,
      group: 'Add component',
      keywords: [def.name, def.id, def.category, ...def.tags].join(' '),
      run: () => {
        const nodeId = newId('node');
        const res = board.getState().dispatch({
          type: 'addNode',
          id: nodeId,
          defId: def.id,
          position: placementForNewNode(board.getState().doc.graph),
        });
        if (!res.ok) return report(res);
        board.getState().setSelection([nodeId]);
        simulation.getState().requestFocus(nodeId);
      },
    });
  }

  // Developer
  cmds.push({
    id: 'dev.perf-fixture',
    title: 'Load 300-node performance board',
    group: 'Developer',
    keywords: 'fixture benchmark fps stress test large',
    run: () => {
      const r = loadPerfFixture(workspace, board);
      if (r.ok) notify('Opened a new board with 300 nodes and 844 connections.');
      else report(r);
    },
  });
  return cmds;
}

function wordStarts(hay: string, q: string): boolean {
  return (
    hay.startsWith(q) || hay.includes(` ${q}`) || hay.includes(`/${q}`) || hay.includes(`.${q}`)
  );
}

/** Every character of `q` in order (loose fallback for one-word queries like "rds"). */
function isSubsequence(hay: string, q: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === q[i] && ++i === q.length) return true;
  return q.length === 0;
}

/**
 * Filter and order commands for a query: every word must match the title, group or keywords.
 * Rank: title starts with the query < a title word starts with each word < title contains it <
 * matched only by keywords/group. Only when nothing matches that way, one-word queries fall back
 * to fuzzy (title letters in order, e.g. "pstgr"). Ties keep the list order; enabled commands
 * come before disabled ones in the same rank.
 */
export function rankCommands(commands: readonly AppCommand[], query: string): AppCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const words = q.split(/\s+/);
  const scored: { c: AppCommand; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const title = c.title.toLowerCase();
    const hay = `${title} ${c.group.toLowerCase()} ${(c.keywords ?? '').toLowerCase()}`;
    let score: number;
    if (title.startsWith(q)) score = 0;
    else if (words.every((w) => wordStarts(title, w))) score = 1;
    else if (words.every((w) => title.includes(w))) score = 2;
    else if (words.every((w) => hay.includes(w))) score = 3;
    else return;
    scored.push({ c, score: score * 2 + (c.disabledReason ? 1 : 0), i });
  });
  if (scored.length === 0 && words.length === 1) {
    commands.forEach((c, i) => {
      if (isSubsequence(c.title.toLowerCase(), q))
        scored.push({ c, score: c.disabledReason ? 1 : 0, i });
    });
  }
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.c);
}
