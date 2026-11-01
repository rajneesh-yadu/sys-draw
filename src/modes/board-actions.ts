/**
 * Board-level actions the modes need, built only on the store's public API: the board's mode and
 * problem are fields of the saved `Board` (core), set with the workspace store's own `setState`
 * (no undo step: they are not design edits); design changes go through `dispatch` (undoable).
 */
import type { BoardStore, Scenario, WorkspaceStore } from '@/store';
import { loadVariantCommand, type DebugCase } from './debug';
import { lessonBoardCommand } from './learn';
import type { Lesson, ModeId, Problem } from './types';

export type ActionResult = { ok: true } | { ok: false; reason: string };

function patchBoard(
  ws: WorkspaceStore,
  boardId: string,
  patch: { mode?: ModeId; problemId?: string | null },
): ActionResult {
  const s = ws.getState();
  const board = s.data.boards[boardId];
  if (!board) return { ok: false, reason: `Board "${boardId}" does not exist` };
  const next = { ...board };
  if (patch.mode !== undefined) next.mode = patch.mode;
  if (patch.problemId === null) delete next.problemId;
  else if (patch.problemId !== undefined) next.problemId = patch.problemId;
  if (next.mode === board.mode && next.problemId === board.problemId) return { ok: true };
  ws.setState({ data: { ...s.data, boards: { ...s.data.boards, [boardId]: next } } });
  return { ok: true };
}

/** Switch the open board (or `boardId`) to another mode. Any mode works on any board. */
export function setBoardMode(ws: WorkspaceStore, mode: ModeId, boardId?: string): ActionResult {
  return patchBoard(ws, boardId ?? ws.getState().activeBoardId, { mode });
}

export function setBoardProblem(
  ws: WorkspaceStore,
  problemId: string | null,
  boardId?: string,
): ActionResult {
  return patchBoard(ws, boardId ?? ws.getState().activeBoardId, { problemId });
}

/**
 * The problem's scenario fitted to an existing design: flow paths are kept only when every node
 * they visit is on the board (otherwise cleared, so the engine follows the graph), and events
 * aimed at missing nodes/edges/groups are dropped.
 */
export function fitScenario(
  s: Scenario,
  graph: { nodes: { id: string }[]; edges: { id: string }[]; groups: { id: string }[] },
): Scenario {
  const ids = new Set([...graph.nodes, ...graph.edges, ...graph.groups].map((x) => x.id));
  const copy = structuredClone(s);
  return {
    ...copy,
    flows: copy.flows.map((f) => (f.path.every((p) => ids.has(p.nodeId)) ? f : { ...f, path: [] })),
    events: copy.events.filter((e) => {
      const ref =
        ('nodeId' in e && e.nodeId) || ('edgeId' in e && e.edgeId) || ('groupId' in e && e.groupId);
      return !ref || ids.has(ref);
    }),
  };
}

/** Practise `problem` on the open board: its scenario (one undo step) and the board's problem. */
export function attachProblem(
  ws: WorkspaceStore,
  board: BoardStore,
  problem: Problem,
): ActionResult {
  const doc = board.getState().doc;
  const res = board.getState().dispatch({
    type: 'updateScenario',
    patch: fitScenario(problem.scenario, doc.graph),
  });
  if (!res.ok) return res;
  return setBoardProblem(ws, problem.id);
}

/** Load a broken design onto the open board (one undo step) and make its problem the board's. */
export function loadDebugCase(ws: WorkspaceStore, board: BoardStore, c: DebugCase): ActionResult {
  const res = board.getState().dispatch(loadVariantCommand(c));
  if (!res.ok) return res;
  return setBoardProblem(ws, c.problem.id);
}

/** Replace the open board's design with a lesson's mini-board (one undo step). */
export function loadLessonBoard(board: BoardStore, lesson: Lesson): ActionResult {
  const cmd = lessonBoardCommand(lesson);
  if (!cmd) return { ok: false, reason: 'This lesson has no mini-board' };
  return board.getState().dispatch(cmd);
}
