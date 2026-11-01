/** Provides the app's mode session store and progress store to the mode UI. */
import { useMemo, type ReactNode } from 'react';
import { ModesContext, type ModesContextValue } from './context';

export function ModesProvider({
  modeStore,
  progressStore,
  children,
}: ModesContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ modeStore, progressStore }), [modeStore, progressStore]);
  return <ModesContext.Provider value={value}>{children}</ModesContext.Provider>;
}
