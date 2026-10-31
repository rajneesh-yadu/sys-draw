import type { ReactNode } from 'react';
import { WorkspaceStoreContext } from './context';
import type { WorkspaceStore } from './workspace-store';

/** Provide a different workspace store to a subtree (tests). Pair it with a BoardStoreProvider for the board store it drives. */
export function WorkspaceStoreProvider({
  store,
  children,
}: {
  store: WorkspaceStore;
  children: ReactNode;
}) {
  return <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>;
}
