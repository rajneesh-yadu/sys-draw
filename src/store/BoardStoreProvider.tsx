import type { ReactNode } from 'react';
import type { BoardStore } from './board-store';
import { BoardStoreContext } from './context';

/** Provide a different board store to a subtree (tests, previews, a second board). */
export function BoardStoreProvider({
  store,
  children,
}: {
  store: BoardStore;
  children: ReactNode;
}) {
  return <BoardStoreContext.Provider value={store}>{children}</BoardStoreContext.Provider>;
}
