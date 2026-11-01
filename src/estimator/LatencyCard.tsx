/** "Latency numbers every engineer should know" — log-scale bars plus a human-scale column. */
import {
  ESTIMATION_RULES,
  LATENCY_NUMBERS,
  formatNs,
  humanScale,
  latencyBarPercent,
} from './latency';

export function LatencyCard() {
  return (
    <details
      open
      className="rounded border border-slate-200 dark:border-slate-800"
      data-testid="latency-card"
    >
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Latency numbers every engineer should know
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="py-1 font-medium">Operation</th>
              <th className="py-1 text-right font-medium">Time</th>
              <th className="w-1/3 py-1 font-medium">
                <span className="sr-only">Relative (log scale)</span>
              </th>
              <th className="py-1 text-right font-medium" title="If an L1 reference took 1 s">
                If L1 = 1 s
              </th>
            </tr>
          </thead>
          <tbody>
            {LATENCY_NUMBERS.map((l) => (
              <tr
                key={l.id}
                className="border-t border-slate-100 dark:border-slate-800"
                data-testid={`latency-${l.id}`}
              >
                <td className="py-1 pr-2">
                  {l.label}
                  {l.hint && <span className="block text-[10px] text-slate-400">{l.hint}</span>}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums">{formatNs(l.ns)}</td>
                <td className="py-1 pr-2" aria-hidden>
                  <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-1.5 rounded bg-sky-500"
                      style={{ width: `${latencyBarPercent(l.ns)}%` }}
                    />
                  </div>
                </td>
                <td className="py-1 text-right text-slate-500 tabular-nums">{humanScale(l.ns)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="grid gap-x-4 gap-y-0.5 text-[11px] text-slate-500 sm:grid-cols-2">
          {ESTIMATION_RULES.map((r) => (
            <li key={r.label}>
              <span className="text-slate-600 dark:text-slate-300">{r.label}:</span> {r.value}
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-slate-400">
          Classic figures popularised by Jeff Dean and Peter Norvig (≈2010 hardware). Today&apos;s
          SSDs and networks are faster; the gaps between rows are what to remember.
        </p>
      </div>
    </details>
  );
}
