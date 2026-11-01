/**
 * The running mode session of the open board (modes-owned zustand store, like canvas' trace
 * store). The runner fills it and installs `act`; panels read `session` and call `act`.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ModeAction, ModeId, ModeSubject } from './types';

export interface ModeSession {
  boardId: string;
  modeId: ModeId;
  problemId: string | undefined;
  /** The controller's state (its own type; panels cast by `modeId`). */
  state: unknown;
  complete: boolean;
  /** Score when complete (0–100), if the mode scores. */
  score: number | undefined;
  subject: ModeSubject | undefined;
  /** Bumped on every state change. */
  version: number;
  /** Clock (ms) of the last change — the panels' "now". */
  atMs: number;
}

export interface ModeStoreState {
  session: ModeSession | null;
  /** Send a panel action to the active controller (no-op until a runner is attached). */
  act(action: ModeAction): void;
}

export type ModeStore = StoreApi<ModeStoreState>;

export function createModeStore(): ModeStore {
  return createStore<ModeStoreState>()(() => ({ session: null, act: () => {} }));
}
