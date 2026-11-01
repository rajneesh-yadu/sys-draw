/** A small accessible popover menu: ⋯ button, arrow-key navigation, Escape/outside click closes. */
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Ask "Confirm …" before running. */
  confirm?: string;
}

/**
 * `owner` (S21): the menu belongs to another control (a board tab) that opens it itself, via
 * `open`/`onOpenChange`. The ⋯ is then a pointer-only affordance (not a second focusable button;
 * a tablist may contain only tabs), and focus returns to `owner()` on close.
 */
export function Menu({
  label,
  items,
  className = '',
  open: controlledOpen,
  onOpenChange,
  owner,
}: {
  label: string;
  items: MenuItem[];
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  owner?: () => HTMLElement | null;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (o: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(o);
    onOpenChange?.(o);
  };
  const [confirming, setConfirming] = useState<MenuItem | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = (focusButton = true) => {
    setOpen(false);
    setConfirming(null);
    if (focusButton) (owner?.() ?? button.current)?.focus();
  };

  // Outside click closes (latest `close`, without re-subscribing on every render).
  const popup = useRef<HTMLDivElement>(null);
  const onOutside = useEffectEvent((e: PointerEvent) => {
    const t = e.target as Node;
    if (!root.current?.contains(t) && !popup.current?.contains(t)) close(false);
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => onOutside(e);
    document.addEventListener('pointerdown', onDown);
    (popup.current ?? root.current)
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
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
      ...((popup.current ?? root.current)?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? []),
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

  const popupEl = (
    <div
      ref={popup}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={owner ? onKeyDown : undefined}
      style={owner ? ownerPosition(owner()) : undefined}
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
  );

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={onKeyDown}>
      {owner ? (
        <span
          aria-hidden="true"
          data-menu-trigger={label}
          title={label}
          onClick={(e) => {
            e.stopPropagation();
            if (open) close();
            else setOpen(true);
          }}
          className="block cursor-pointer rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <MoreHorizontal size={14} aria-hidden />
        </span>
      ) : (
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
          className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
      )}
      {open &&
        (owner
          ? // S21: a tab-owned menu renders outside the tablist (only tabs may live there).
            createPortal(popupEl, document.body)
          : popupEl)}
    </div>
  );
}

/** Fixed position under the owner's right edge (portalled menus). */
function ownerPosition(el: HTMLElement | null): React.CSSProperties | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { position: 'fixed', top: r.bottom + 4, left: r.left, right: 'auto' };
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
      className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-200 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:hover:bg-slate-700 dark:hover:text-slate-100"
    >
      {children}
    </button>
  );
}
