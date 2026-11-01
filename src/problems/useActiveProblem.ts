/** S17: the open board's problem, mode and id, read from the workspace store. */
import { registry as appRegistry, type Registry } from '@/registry';
import { useWorkspaceStore } from '@/store';
import { findProblem } from './library';

/** The open board's problem (undefined for free boards or an unknown id). */
export function useActiveProblem(registry: Registry = appRegistry) {
  const problemId = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.problemId);
  const mode = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.mode ?? 'sandbox');
  const boardId = useWorkspaceStore((s) => s.activeBoardId);
  return { problem: findProblem(registry, problemId), problemId, mode, boardId };
}
