/** A small accessible popover menu: ⋯ button, arrow-key navigation, Escape/outside click closes. */
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Ask "Confirm …" before running. */
  confirm?: string;
}

export function Menu({
  label,
  items,
  className = '',
}: {
  label: string;
  items: MenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<MenuItem | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = (focusButton = true) => {
    setOpen(false);
    setConfirming(null);
    if (focusButton) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, confirming]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const els = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    ];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next]?.focus();
  };

  const run = (item: MenuItem) => {
    if (item.confirm !== undefined) {
      setConfirming(item);
      return;
    }
    close();
    item.onSelect();
  };

  const itemClass = (danger?: boolean) =>
    `block w-full px-3 py-1 text-left whitespace-nowrap hover:bg-slate-100 focus:bg-slate-100 focus:outline-none disabled:opacity-40 dark:hover:bg-slate-700 dark:focus:bg-slate-700 ${
      danger ? 'text-red-600 dark:text-red-400' : ''
    }`;

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:hover:bg-slate-700 dark:hover:text-slate-200"
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-50 mt-1 min-w-40 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          {confirming ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  const item = confirming;
                  close();
                  item.onSelect();
                }}
                className={itemClass(confirming.danger)}
              >
                {confirming.confirm ?? confirming.label}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(null);
                }}
                className={itemClass()}
              >
                Cancel
              </button>
            </>
          ) : (
            items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  run(item);
                }}
                className={itemClass(item.danger)}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Text input that commits on Enter/blur and cancels on Escape. */
export function InlineEdit({
  value,
  label,
  onCommit,
  onCancel,
}: {
  value: string;
  label: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && text.trim() !== '' && text !== value) onCommit(text);
    else onCancel();
  };
  return (
    <input
      aria-label={label}
      value={text}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-full min-w-0 rounded border border-sky-500 bg-white px-1 py-0 text-sm text-slate-900 outline-none dark:bg-slate-900 dark:text-slate-100"
    />
  );
}

export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:hover:bg-slate-700 dark:hover:text-slate-100"
    >
      {children}
    </button>
  );
}
