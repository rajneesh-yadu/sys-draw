/**
 * S16: threat review beside the canvas — findings worst first, each with its explanation, the
 * fix in words and (when the rule has one) a one-click fix; plus the overlay legend.
 */
import { ShieldAlert, X } from 'lucide-react';
import { useBoardStoreApi } from '@/store';
import { useSecurityStore, useSecurityStoreApi } from './context';
import {
  ENCRYPTION_STROKE,
  EXPOSURE_STYLE,
  SEVERITY_ORDER,
  SEVERITY_STYLE,
  severityCounts,
  type SecurityExposure,
  type SecurityViewFinding,
} from './security-store';

const EXPOSURE_LEGEND: [SecurityExposure, string][] = [
  ['exposed', 'Internet-facing'],
  ['dmz', 'DMZ'],
  ['internal', 'Private / data'],
  ['unzoned', 'No zone'],
];

export function SecurityPanel() {
  const api = useSecurityStoreApi();
  const open = useSecurityStore((s) => s.open);
  const view = useSecurityStore((s) => s.view);
  const lastFix = useSecurityStore((s) => s.lastFix);
  if (!open) return null;
  const findings = view?.findings ?? [];
  const counts = severityCounts(findings);
  return (
    <aside
      aria-label="Security review"
      className="flex h-full w-96 shrink-0 flex-col border-l border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-950"
    >
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <ShieldAlert aria-hidden className="h-4 w-4 text-red-600" />
        <h2 className="font-semibold">Security review</h2>
        <span className="text-xs text-slate-500" data-testid="security-counts">
          {SEVERITY_ORDER.filter((s) => counts[s] > 0)
            .map((s) => `${counts[s]} ${s}`)
            .join(' · ') || 'no findings'}
        </span>
        <button
          type="button"
          className="ml-auto rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close security review"
          onClick={() => api.getState().setOpen(false)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <Legend />
        {lastFix && (
          <p
            role="status"
            className={`rounded px-2 py-1 text-xs ${lastFix.ok ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200'}`}
          >
            {lastFix.message}
          </p>
        )}
        {findings.length === 0 ? (
          <p className="text-xs text-slate-500">
            No threats found. Put components in zoned groups (subnet → Security → zone) to check
            exposure and security-group rules.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Findings">
            {findings.map((f) => (
              <FindingItem key={f.key} f={f} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function FindingItem({ f }: { f: SecurityViewFinding }) {
  const board = useBoardStoreApi();
  const api = useSecurityStoreApi();
  const ids = f.targetIds.filter((id) => /^(node|edge|grp)_/.test(id));
  return (
    <li
      data-testid="security-finding"
      data-severity={f.severity}
      data-rule={f.ruleId}
      className="rounded-md border border-slate-200 p-2 dark:border-slate-800"
    >
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLE[f.severity]}`}
        >
          {f.severity}
        </span>
        <button
          type="button"
          className="text-left font-medium hover:underline disabled:no-underline"
          disabled={ids.length === 0}
          onClick={() => board.getState().setSelection(ids)}
          title={ids.length > 0 ? 'Select on the canvas' : undefined}
        >
          {f.title}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{f.message}</p>
      {f.fix && (
        <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
          <span className="font-semibold">Fix: </span>
          {f.fix}
        </p>
      )}
      {f.fixLabel && (
        <button
          type="button"
          className="mt-2 rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          onClick={() => api.getState().fix(f.key)}
        >
          Fix: {f.fixLabel}
        </button>
      )}
    </li>
  );
}

function Legend() {
  return (
    <div className="space-y-1 rounded-md bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-400">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-semibold">Components:</span>
        {EXPOSURE_LEGEND.map(([k, label]) => (
          <span key={k} className={`rounded px-1 py-0.5 ${EXPOSURE_STYLE[k].pill}`}>
            {label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Connections:</span>
        {(
          [
            ['tls', 'Encrypted (TLS)'],
            ['mtls', 'mTLS'],
            ['plaintext', 'Plaintext (dashed)'],
          ] as const
        ).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1">
            <svg width="18" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="18"
                y2="3"
                stroke={ENCRYPTION_STROKE[k].stroke}
                strokeWidth="2"
                strokeDasharray={ENCRYPTION_STROKE[k].dashed ? '4 3' : undefined}
              />
            </svg>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
