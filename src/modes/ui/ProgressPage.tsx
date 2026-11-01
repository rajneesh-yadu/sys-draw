/** Progress: attempts, scores and time per problem and lesson (stored locally). */
import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { modeLabel } from '../registry';
import { formatDuration, progressSummary } from '../progress';
import { useProgressStore, useProgressStoreApi } from './context';
import { Dialog } from './Dialog';
import { button } from './styles';

export function ProgressButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={button}
        onClick={() => setOpen(true)}
        data-testid="open-progress"
      >
        <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Progress
      </button>
      {open && <ProgressPage onClose={() => setOpen(false)} />}
    </>
  );
}

export function ProgressPage({ onClose }: { onClose: () => void }) {
  const attempts = useProgressStore((s) => s.attempts);
  const warning = useProgressStore((s) => s.warning);
  const api = useProgressStoreApi();
  const [confirm, setConfirm] = useState(false);
  const rows = progressSummary(attempts);
  const totalMs = attempts.reduce((s, a) => s + a.durationMs, 0);
  const recent = [...attempts].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10);
  const score = (s: number | undefined) => (s === undefined ? '—' : String(s));
  return (
    <Dialog title="Your progress" onClose={onClose} testId="progress-page">
      <div className="space-y-4 p-4 text-sm">
        {warning && <p className="text-xs text-amber-700">{warning}</p>}
        <p className="text-xs text-slate-500" data-testid="progress-totals">
          {attempts.length} attempt{attempts.length === 1 ? '' : 's'} ·{' '}
          {attempts.filter((a) => a.completed).length} completed · {formatDuration(totalMs)}{' '}
          practised. Stored in this browser only.
        </p>
        {rows.length === 0 ? (
          <p className="text-slate-500">
            No attempts yet. Start a problem in Guided, Interview or Debug mode, or pass a lesson
            quiz in Learn mode.
          </p>
        ) : (
          <table className="w-full text-left text-xs" data-testid="progress-table">
            <caption className="sr-only">Attempts, scores and time per problem and lesson</caption>
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
              <tr>
                <th className="py-1 font-medium">Problem / lesson</th>
                <th className="font-medium">Attempts</th>
                <th className="font-medium">Completed</th>
                <th className="font-medium">Best</th>
                <th className="font-medium">Last</th>
                <th className="font-medium">Time</th>
                <th className="font-medium">By mode</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.subjectKind}:${r.subjectId}`}
                  className="border-b border-slate-100 dark:border-slate-900"
                  data-testid={`progress-row-${r.subjectId}`}
                >
                  <td className="py-1.5">
                    {r.title}
                    <span className="ml-1 text-slate-400">
                      {r.subjectKind === 'lesson' ? 'lesson' : ''}
                    </span>
                  </td>
                  <td className="tabular-nums">{r.attempts}</td>
                  <td className="tabular-nums">{r.completed}</td>
                  <td className="tabular-nums">{score(r.bestScore)}</td>
                  <td className="tabular-nums">{score(r.lastScore)}</td>
                  <td className="tabular-nums">{formatDuration(r.totalMs)}</td>
                  <td className="text-slate-600 dark:text-slate-300">
                    {r.byMode
                      .map(
                        (m) =>
                          `${modeLabel(m.mode)} ×${m.attempts}${m.bestScore !== undefined ? ` (best ${m.bestScore})` : ''}`,
                      )
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {recent.length > 0 && (
          <section aria-label="Recent attempts" className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Recent</h3>
            <ul className="space-y-0.5 text-xs">
              {recent.map((a) => (
                <li key={a.id}>
                  {new Date(a.startedAt).toLocaleString()} · {a.title} · {modeLabel(a.mode)} ·{' '}
                  {formatDuration(a.durationMs)} ·{' '}
                  {a.completed
                    ? `done${a.score !== undefined ? `, ${a.score}` : ''}`
                    : 'unfinished'}
                </li>
              ))}
            </ul>
          </section>
        )}
        {attempts.length > 0 &&
          (confirm ? (
            <p className="flex items-center gap-2 text-xs">
              Delete all progress?
              <button
                type="button"
                className={button}
                onClick={() => (api.getState().clear(), setConfirm(false))}
              >
                Yes, clear
              </button>
              <button type="button" className={button} onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </p>
          ) : (
            <button type="button" className={button} onClick={() => setConfirm(true)}>
              Clear progress…
            </button>
          ))}
      </div>
    </Dialog>
  );
}
