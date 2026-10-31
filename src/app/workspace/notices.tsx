/** One status line for workspace actions (import results, refused deletes, save errors). */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NoticeContext, useNotice, type Notice } from './notice-context';

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const show = useCallback((n: Notice | null) => setNotice(n), []);
  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  return <NoticeContext.Provider value={{ notice, show }}>{children}</NoticeContext.Provider>;
}

export function NoticeLine() {
  const { notice, show } = useNotice();
  return (
    <div role="status" aria-live="polite" data-testid="workspace-notice">
      {notice && (
        <div
          className={`m-2 flex gap-2 rounded px-2 py-1.5 text-xs whitespace-pre-line ${
            notice.kind === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
          }`}
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 opacity-60 hover:opacity-100"
            onClick={() => show(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
