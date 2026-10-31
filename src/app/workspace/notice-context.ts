import { createContext, useContext } from 'react';

export interface Notice {
  kind: 'info' | 'error';
  text: string;
}

export const NoticeContext = createContext<{
  notice: Notice | null;
  show: (n: Notice | null) => void;
}>({ notice: null, show: () => {} });

/** The workspace status line: `show({kind, text})` or `show(null)`. */
export function useNotice() {
  return useContext(NoticeContext);
}
