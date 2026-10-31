import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import {
  formatMs,
  formatPercent,
  formatRps,
  formatUsd,
  utilizationLevel,
  UTILIZATION_LEVEL_LABEL,
  UTILIZATION_THRESHOLDS,
  type NodeMetrics,
} from '@/store';
import { nodeFormula, type NodeField } from './formulas';
import { FormulaValue } from './FormulaValue';

const LEVEL_BAR: Record<string, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  hot: 'bg-red-600',
};

/** Utilisation meter with the 60 % / 85 % band marks; colour + label, never colour alone. */
export function UtilizationMeter({ m }: { m: NodeMetrics }) {
  const level = utilizationLevel(m.utilization);
  const width = Math.min(1, Math.max(0, m.utilization)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-slate-500">Utilisation</span>
        <span className="font-medium" data-testid="node-detail-level">
          <FormulaValue label="Utilisation" formula={nodeFormula('utilization', m)}>
            {formatPercent(m.utilization)}
          </FormulaValue>{' '}
          · {UTILIZATION_LEVEL_LABEL[level]}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Utilisation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(m.utilization * 100)}
        aria-valuetext={`${formatPercent(m.utilization)}, ${UTILIZATION_LEVEL_LABEL[level]}`}
        className="relative h-2.5 rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <div
          className={`h-full rounded-full ${LEVEL_BAR[level] ?? ''}`}
          style={{ width: `${width}%` }}
        />
        {[UTILIZATION_THRESHOLDS.warn, UTILIZATION_THRESHOLDS.hot].map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute -top-0.5 h-3.5 w-px bg-slate-400 dark:bg-slate-500"
            style={{ left: `${t * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** p50 / p95 / p99 at one component: a single-series bar chart (one hue, hover tooltip). */
export function LatencyChart({ m }: { m: NodeMetrics }) {
  const data = [
    { name: 'p50', ms: m.latencyMs.p50 },
    { name: 'p95', ms: m.latencyMs.p95 },
    { name: 'p99', ms: m.latencyMs.p99 },
  ];
  return (
    <figure aria-label="Latency percentiles" className="text-slate-500">
      <BarChart
        width={280}
        height={96}
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.12} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: 'currentColor' }}
          tickFormatter={(v: number) => formatMs(v)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={32}
          tick={{ fontSize: 10, fill: 'currentColor' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'currentColor', fillOpacity: 0.06 }}
          formatter={(v) => [formatMs(Number(v)), 'Latency']}
          contentStyle={{ fontSize: 11, padding: '2px 6px' }}
        />
        <Bar
          dataKey="ms"
          fill="#0284c7"
          radius={[0, 4, 4, 0]}
          barSize={12}
          isAnimationActive={false}
        />
      </BarChart>
      <figcaption className="sr-only">
        p50 {formatMs(m.latencyMs.p50)}, p95 {formatMs(m.latencyMs.p95)}, p99{' '}
        {formatMs(m.latencyMs.p99)}
      </figcaption>
    </figure>
  );
}

/** Per-node metrics: utilisation meter, latency chart and every number with its formula. */
export function NodeDetail({ label, m }: { label: string; m: NodeMetrics }) {
  const rows: [NodeField, string, string][] = [
    ['rpsIn', 'Requests in', formatRps(m.rpsIn)],
    ['rpsOut', 'Served', formatRps(m.rpsOut)],
    [
      'queueDepth',
      'Queue depth',
      m.queueDepth < 10 ? m.queueDepth.toFixed(2) : String(Math.round(m.queueDepth)),
    ],
    ['p50', 'p50', formatMs(m.latencyMs.p50)],
    ['p95', 'p95', formatMs(m.latencyMs.p95)],
    ['p99', 'p99', formatMs(m.latencyMs.p99)],
    ['errorRate', 'Error rate', formatPercent(m.errorRate)],
    ...(m.hitRate !== undefined
      ? ([['hitRate', 'Cache hit rate', formatPercent(m.hitRate)]] as [NodeField, string, string][])
      : []),
    ['costPerMonth', 'Cost / month', formatUsd(m.costPerMonth)],
  ];
  return (
    <div data-testid="node-detail" className="space-y-2">
      <h3 className="truncate text-sm font-semibold">{label}</h3>
      <UtilizationMeter m={m} />
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-0.5 text-xs">
        {rows.map(([field, name, value]) => (
          <div key={field} className="flex items-baseline justify-between gap-2">
            <dt className="truncate text-slate-500">{name}</dt>
            <dd className="whitespace-nowrap">
              <FormulaValue label={name} formula={nodeFormula(field, m)}>
                {value}
              </FormulaValue>
            </dd>
          </div>
        ))}
      </dl>
      <LatencyChart m={m} />
    </div>
  );
}
