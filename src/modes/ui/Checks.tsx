/** A ✓/✗ checklist; the meaning is in text, not only in colour. */
import { Check, X } from 'lucide-react';
import { badText, okText } from './styles';

export interface CheckRow {
  label: string;
  ok: boolean;
  detail?: string | undefined;
}

export function Checks({ items, label }: { items: CheckRow[]; label: string }) {
  return (
    <ul className="space-y-1" aria-label={label}>
      {items.map((i) => (
        <li key={i.label} className="flex items-start gap-1.5 text-xs" data-ok={i.ok}>
          {i.ok ? (
            <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${okText}`} aria-hidden />
          ) : (
            <X className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${badText}`} aria-hidden />
          )}
          <span>
            <span className="sr-only">{i.ok ? 'Passed: ' : 'Not yet: '}</span>
            {i.label}
            {i.detail && <span className="text-slate-500"> — {i.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
