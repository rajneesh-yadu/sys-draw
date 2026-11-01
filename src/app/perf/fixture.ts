/**
 * S21: the 300-node performance fixture (ARCHITECTURE.md: "canvas stays at 60 fps with 300
 * nodes"). A realistic 3-tier fan-out — 1 client → 4 load balancers → 280 app servers → 5 Redis
 * caches + 10 Postgres shards — laid out on a grid, built as ONE `batch` command of ordinary
 * `addNode`/`connect` commands so every node gets its registry defaults and every edge its
 * default protocol stack (no hand-written data to drift from the schemas).
 *
 * Open it in the app with `?fixture=perf-300` or the command palette ("Load 300-node
 * performance board"); the e2e perf test does the former.
 */
import type { BoardCommand, BoardStore, WorkspaceStore } from '@/store';

export const PERF_FIXTURE_NODES = 300;
export const PERF_FIXTURE_BOARD_NAME = 'Perf · 300 nodes';

const COLS = 20;
const CELL_X = 240;
const CELL_Y = 140;

export interface PerfFixtureShape {
  clients: number;
  lbs: number;
  apps: number;
  caches: number;
  dbs: number;
}

/** How a fixture of `total` nodes splits into tiers (≥ 1 of each; apps take the rest). */
export function perfFixtureShape(total = PERF_FIXTURE_NODES): PerfFixtureShape {
  const t = Math.max(5, Math.floor(total));
  const lbs = Math.max(1, Math.round(t / 75));
  const caches = Math.max(1, Math.round(t / 60));
  const dbs = Math.max(1, Math.round(t / 30));
  return { clients: 1, lbs, apps: t - 1 - lbs - caches - dbs, caches, dbs };
}

const id = (tier: string, i: number) => `node_perf${tier}${String(i).padStart(3, '0')}`;
const edgeId = (n: number) => `edge_perf${String(n).padStart(4, '0')}`;

/** One undoable `batch`: all nodes, then all edges (ids are deterministic). */
export function perfFixtureCommand(total = PERF_FIXTURE_NODES): BoardCommand {
  const s = perfFixtureShape(total);
  const commands: BoardCommand[] = [];
  const appRows = Math.ceil(s.apps / COLS);
  const midX = ((COLS - 1) * CELL_X) / 2;
  const row = (count: number, y: number, tier: string, defId: string, label: string) => {
    // Spread the tier evenly across the width of the app grid.
    for (let i = 0; i < count; i++) {
      const x = count === 1 ? midX : (i / (count - 1)) * (COLS - 1) * CELL_X;
      commands.push({
        type: 'addNode',
        id: id(tier, i),
        defId,
        label: `${label} ${i + 1}`,
        position: { x: Math.round(x), y },
      });
    }
  };
  row(s.clients, 0, 'c', 'client.app', 'Users');
  row(s.lbs, CELL_Y, 'l', 'network.load-balancer', 'LB');
  for (let i = 0; i < s.apps; i++) {
    commands.push({
      type: 'addNode',
      id: id('a', i),
      defId: 'compute.app-server',
      label: `API ${i + 1}`,
      position: { x: (i % COLS) * CELL_X, y: CELL_Y * (2 + Math.floor(i / COLS)) },
    });
  }
  const dataY = CELL_Y * (2 + appRows) + CELL_Y;
  row(s.caches, dataY, 'r', 'cache.redis', 'Redis');
  row(s.dbs, dataY + CELL_Y, 'd', 'database.postgres', 'Postgres');

  let e = 0;
  const connect = (source: string, target: string) =>
    commands.push({ type: 'connect', id: edgeId(e++), source, target });
  for (let c = 0; c < s.clients; c++)
    for (let l = 0; l < s.lbs; l++) connect(id('c', c), id('l', l));
  for (let i = 0; i < s.apps; i++) {
    connect(id('l', i % s.lbs), id('a', i));
    connect(id('a', i), id('r', i % s.caches));
    connect(id('a', i), id('d', i % s.dbs));
  }
  return { type: 'batch', label: `Load ${total}-node performance board`, commands };
}

/**
 * Open a new board in the active project and fill it with the fixture (one undo step).
 * Returns the board id, or the reason it failed.
 */
export function loadPerfFixture(
  workspace: WorkspaceStore,
  board: BoardStore,
  total = PERF_FIXTURE_NODES,
): { ok: true; boardId: string } | { ok: false; reason: string } {
  const created = workspace.getState().createBoard(undefined, PERF_FIXTURE_BOARD_NAME);
  if (!created.ok) return created;
  const res = board.getState().dispatch(perfFixtureCommand(total));
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, boardId: created.boardId };
}
