import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Only one formula tooltip is open at a time: opening one closes the others.
const closers = new Map<string, () => void>();

/**
 * A number with a "show formula" tooltip. The value is a button: hover, focus or click shows the
 * formula; Escape hides it. Screen readers get the formula as the button's description.
 */
export function FormulaValue({
  label,
  formula,
  children,
  className = '',
}: {
  /** What the number is ("p99", "Availability"), for the accessible name. */
  label: string;
  formula: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closers.set(id, () => {
      setHover(false);
      setFocus(false);
      setPinned(false);
    });
    return () => void closers.delete(id);
  }, [id]);
  useEffect(() => {
    if (!open) return;
    for (const [other, close] of closers) if (other !== id) close();
  }, [open, id]);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  // Fixed position from the button, so the drawer's scroll container never clips the tooltip.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const width = 288;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      bottom: window.innerHeight - r.top + 4,
    });
  }, [open]);
  return (
    <span className="relative inline-flex">
      <button
        ref={ref}
        type="button"
        aria-label={`${label}: show formula`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
        }}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            // Close the tooltip only; don't let the canvas treat it as "clear selection".
            e.stopPropagation();
            setPinned(false);
            setFocus(false);
            setHover(false);
          }
        }}
        className={`cursor-help rounded tabular-nums underline decoration-slate-400 decoration-dotted underline-offset-2 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:hover:bg-slate-800 ${className}`}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={pos ? { left: pos.left, bottom: pos.bottom } : { visibility: 'hidden' }}
            className="fixed z-50 w-72 rounded-md border border-slate-200 bg-white p-2 text-left text-xs leading-snug font-normal whitespace-normal text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <span className="mb-0.5 block text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
              Formula · {label}
            </span>
            <span className="font-mono text-[11px] break-words">{formula}</span>
          </span>,
          document.body,
        )}
    </span>
  );
}
