/**
 * S21: Ctrl/⌘+K command palette — a combobox over `rankCommands`. ↑/↓ (and Home/End) move,
 * Enter runs, Escape or a click outside closes; focus returns to where it was.
 */
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { rankCommands, type AppCommand } from './commands';

/** Rendered rows are capped; typing narrows the rest. */
export const MAX_VISIBLE_COMMANDS = 60;

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly AppCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);
  const visible = results.slice(0, MAX_VISIBLE_COMMANDS);
  const current = Math.min(active, Math.max(0, visible.length - 1));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const runAt = (i: number) => {
    const c = visible[i];
    if (!c || c.disabledReason) return;
    onClose();
    c.run();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(visible.length ? (current + 1) % visible.length : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(visible.length ? (current - 1 + visible.length) % visible.length : 0);
        break;
      case 'Home':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setActive(Math.max(0, visible.length - 1));
        }
        break;
      case 'Enter':
        e.preventDefault();
        runAt(current);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case 'Tab':
        // Single-field dialog: keep focus in the input.
        e.preventDefault();
        break;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-700">
          <Search size={16} aria-hidden className="text-slate-500 dark:text-slate-400" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={visible.length ? optionId(current) : undefined}
            aria-label="Search commands and components"
            placeholder="Type a command or a component…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500 dark:placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-300 px-1 text-[10px] text-slate-600 dark:border-slate-600 dark:text-slate-300">
            Esc
          </kbd>
        </div>
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {visible.map((c, i) => (
            <li
              key={c.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              aria-disabled={c.disabledReason ? true : undefined}
              data-index={i}
              data-command-id={c.id}
              onPointerMove={() => i !== current && setActive(i)}
              onClick={() => runAt(i)}
              className={`mx-1 flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm ${
                i === current ? 'bg-sky-100 dark:bg-sky-900/60' : ''
              } ${c.disabledReason ? 'cursor-not-allowed text-slate-500 dark:text-slate-400' : ''}`}
            >
              <span className="min-w-0 flex-1 truncate">
                {c.title}
                {c.disabledReason && (
                  <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                    — {c.disabledReason}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-slate-600 dark:text-slate-400">{c.group}</span>
              {c.shortcut && (
                <kbd className="shrink-0 rounded border border-slate-300 px-1 font-mono text-[10px] text-slate-600 dark:border-slate-600 dark:text-slate-300">
                  {c.shortcut}
                </kbd>
              )}
            </li>
          ))}
          {visible.length === 0 && (
            <li
              className="px-3 py-6 text-center text-sm text-slate-600 dark:text-slate-400"
              role="presentation"
            >
              No commands match “{query}”.
            </li>
          )}
        </ul>
        {results.length > visible.length && (
          <p className="border-t border-slate-200 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {results.length - visible.length} more — keep typing to narrow down.
          </p>
        )}
      </div>
    </div>
  );
}
