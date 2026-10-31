import type { ReactNode } from 'react';
import { SimulationStoreContext } from './context';
import type { SimulationStore } from './simulation';

/** Provide a different simulation store to a subtree (tests, previews). */
export function SimulationStoreProvider({
  store,
  children,
}: {
  store: SimulationStore;
  children: ReactNode;
}) {
  return (
    <SimulationStoreContext.Provider value={store}>{children}</SimulationStoreContext.Provider>
  );
}
