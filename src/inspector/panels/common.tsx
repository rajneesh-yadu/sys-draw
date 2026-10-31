/** Small shared pieces for the inspector panels. */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function PanelTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {subtitle !== undefined && <p className="text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

/** Accessible two-tab switcher (Settings | Docs) with arrow-key navigation. */
export function Tabs({ tabs }: { tabs: { id: string; label: string; content: ReactNode }[] }) {
  const base = useId();
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d === 0) return;
    e.preventDefault();
    const next = (i + d + tabs.length) % tabs.length;
    setActive(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div>
      <div role="tablist" className="flex border-b border-slate-200 px-3 dark:border-slate-800">
        {tabs.map((t, i) => {
          const selected = t.id === current?.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none ${
                selected
                  ? 'border-sky-600 text-sky-700 dark:text-sky-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {current && (
        <div
          role="tabpanel"
          id={`${base}-panel-${current.id}`}
          aria-labelledby={`${base}-tab-${current.id}`}
          className="space-y-4 p-3"
        >
          {current.content}
        </div>
      )}
    </div>
  );
}
