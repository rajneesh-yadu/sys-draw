/** S21: the keyboard shortcut sheet ("?"), rendered from `shortcutSheet()`. */
import { Dialog } from '../ui/Dialog';
import { shortcutSheet } from './shortcuts';

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const groups = shortcutSheet();
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} testId="shortcut-sheet">
      <div className="grid gap-6 p-4 sm:grid-cols-2">
        {groups.map((g) => (
          <section
            key={g.title}
            aria-label={g.title}
            className={g.title === 'Canvas' ? 'sm:row-span-2' : ''}
          >
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400">
              {g.title}
            </h3>
            <dl className="space-y-1.5 text-sm">
              {g.rows.map((r) => (
                <div
                  key={`${r.keys}-${r.label}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="text-slate-700 dark:text-slate-200">{r.label}</dt>
                  <dd className="shrink-0">
                    <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                      {r.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
        On macOS use ⌘ where it says Ctrl. Shortcuts that act on the board are ignored while you
        type in a field.
      </p>
    </Dialog>
  );
}
