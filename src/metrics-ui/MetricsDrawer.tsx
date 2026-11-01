import { useState } from 'react';
import {
  formatMs,
  formatPercent,
  formatRps,
  formatUsd,
  useBoardStore,
  useBoardStoreApi,
  useSimulationStore,
  useSimulationStoreApi,
  utilizationLevel,
  type Finding,
  type Scenario,
  type SimResult,
} from '@/store';
import {
  bottleneckRows,
  flowFormula,
  flowName,
  regionFormula,
  regionRows,
  systemFormulas,
  type FlowField,
  type RegionField,
} from './formulas';
import { FormulaValue } from './FormulaValue';
import { NodeDetail } from './NodeDetail';

const btn =
  'rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-800';

/**
 * Bottom drawer: header (status, Run, Hide/Show) and, when open, system KPIs with per-flow
 * percentiles, the bottleneck list (click to select + focus on the canvas) and the selected
 * component's metrics. Reads only the store's simulation result.
 */
export function MetricsDrawer({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const sim = useSimulationStoreApi();
  return (
    <>
      <div className="flex items-center gap-3 px-3 py-1.5">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Metrics</h2>
        <RunStatus />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => sim.getState().requestRun()}
            className={`${btn} font-medium text-sky-700 dark:text-sky-300`}
            title="Simulate the board now (it also re-runs 300 ms after every change)"
          >
            Run
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="metrics-drawer-body"
            className={btn}
          >
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {open && (
        <div
          id="metrics-drawer-body"
          className="h-60 overflow-y-auto border-t border-slate-100 dark:border-slate-800"
        >
          <DrawerBody />
        </div>
      )}
    </>
  );
}

function RunStatus() {
  const status = useSimulationStore((s) => s.status);
  const error = useSimulationStore((s) => s.error);
  const durationMs = useSimulationStore((s) => s.durationMs);
  const text =
    status === 'running'
      ? 'Simulating…'
      : status === 'error'
        ? `Simulation failed: ${error ?? 'unknown error'}`
        : status === 'done'
          ? `Up to date${durationMs !== null ? ` (${formatMs(durationMs)})` : ''}`
          : 'Not simulated yet';
  return (
    <span
      role="status"
      data-testid="sim-status"
      data-status={status}
      className={`truncate text-xs ${status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}
    >
      {text}
    </span>
  );
}

function DrawerBody() {
  const result = useSimulationStore((s) => s.result);
  const scenario = useBoardStore((s) => s.doc.scenario);
  const nodes = useBoardStore((s) => s.doc.graph.nodes);
  const selection = useBoardStore((s) => s.selection);
  if (!result) {
    return <p className="p-3 text-sm text-slate-400">Results appear here after the first run.</p>;
  }
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label;
  const selectedId = selection.find((id) => result.perNode[id] !== undefined);
  const selected = selectedId !== undefined ? result.perNode[selectedId] : undefined;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-slate-100 dark:divide-slate-800">
      <div className="space-y-3 p-3">
        <section aria-label="System" className="space-y-3">
          <SystemKpis result={result} scenario={scenario} />
          <FlowTable result={result} scenario={scenario} />
          <RegionTable result={result} />
        </section>
        <section aria-label="Bottlenecks" className="space-y-3">
          <Bottlenecks result={result} labelOf={labelOf} />
          <Findings findings={result.findings} />
        </section>
      </div>
      <section aria-label="Component" className="p-3">
        {selected && selectedId !== undefined ? (
          <NodeDetail label={labelOf(selectedId) ?? selectedId} m={selected} />
        ) : (
          <p className="text-sm text-slate-400">
            Select a component (or a bottleneck) to see its utilisation, queue and latency.
          </p>
        )}
      </section>
    </div>
  );
}

function SystemKpis({ result, scenario }: { result: SimResult; scenario: Scenario }) {
  const f = systemFormulas(result, scenario);
  const errorRate = 1 - result.system.availability;
  const kpis: [string, string, string, boolean][] = [
    ['Throughput', formatRps(result.system.rps), f.rps, false],
    ['Error rate', formatPercent(errorRate), f.errorRate, errorRate > 0.001],
    ['Availability', formatPercent(result.system.availability), f.availability, false],
    ['Cost / month', formatUsd(result.system.costPerMonth), f.costPerMonth, false],
  ];
  return (
    <dl
      className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2"
      data-testid="system-kpis"
    >
      {kpis.map(([label, value, formula, bad]) => (
        <div key={label} className="min-w-0">
          <dt className="truncate text-[10px] tracking-wide text-slate-500 uppercase">{label}</dt>
          <dd className={`text-base font-semibold ${bad ? 'text-red-600 dark:text-red-400' : ''}`}>
            <FormulaValue label={label} formula={formula}>
              {value}
            </FormulaValue>
          </dd>
        </div>
      ))}
    </dl>
  );
}

const FLOW_COLS: [FlowField, string][] = [
  ['rps', 'rps'],
  ['p50', 'p50'],
  ['p95', 'p95'],
  ['p99', 'p99'],
  ['errorRate', 'Errors'],
];

function FlowTable({ result, scenario }: { result: SimResult; scenario: Scenario }) {
  const flows = Object.entries(result.perFlow);
  if (flows.length === 0) return null;
  return (
    <table className="w-full text-xs" data-testid="flow-table">
      <caption className="sr-only">Latency per flow</caption>
      <thead>
        <tr className="text-left text-[10px] tracking-wide text-slate-500 uppercase">
          <th scope="col" className="py-0.5 font-medium">
            Flow
          </th>
          {FLOW_COLS.map(([, h]) => (
            <th key={h} scope="col" className="py-0.5 text-right font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {flows.map(([id, f]) => {
          const name = flowName(id, scenario);
          const values: Record<FlowField, string> = {
            rps: formatRps(f.rps).replace(' rps', ''),
            p50: formatMs(f.p50),
            p95: formatMs(f.p95),
            p99: formatMs(f.p99),
            errorRate: formatPercent(f.errorRate),
          };
          return (
            <tr
              key={id}
              data-flow-id={id}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <th
                scope="row"
                className="max-w-0 truncate py-0.5 pr-2 text-left font-normal"
                title={name}
              >
                {name}
              </th>
              {FLOW_COLS.map(([field, h]) => (
                <td key={field} className="py-0.5 text-right" data-col={field}>
                  <FormulaValue
                    label={`${h} of ${name}`}
                    formula={flowFormula(field, f, scenario)}
                    className={field === 'p99' ? 'font-semibold' : ''}
                  >
                    {values[field]}
                  </FormulaValue>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Per user region (S10): where they are served from, network time, p50/p99 — the place to see
 * that far-away users pay the round trip.
 */
function RegionTable({ result }: { result: SimResult }) {
  const rows = regionRows(result);
  if (rows.length === 0) return null;
  const showErrors = rows.some((r) => r.m.errorRate > 0);
  const cols: [RegionField, string][] = [
    ['rps', 'rps'],
    ['servedFrom', 'From'],
    ['networkMs', 'Network'],
    ['p50', 'p50'],
    ['p99', 'p99'],
    ...(showErrors ? ([['errorRate', 'Errors']] as [RegionField, string][]) : []),
  ];
  return (
    <table className="w-full text-xs" data-testid="region-table">
      <caption className="mb-1 text-left text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
        Latency by user region
      </caption>
      <thead>
        <tr className="text-left text-[10px] tracking-wide text-slate-500 uppercase">
          <th scope="col" className="py-0.5 font-medium">
            Users in
          </th>
          {cols.map(([, h]) => (
            <th key={h} scope="col" className="py-0.5 text-right font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ id, m }) => {
          const values: Record<RegionField, string> = {
            rps: formatRps(m.rps).replace(' rps', ''),
            servedFrom: m.servedFrom ?? '—',
            networkMs: formatMs(m.networkMs),
            p50: formatMs(m.p50),
            p99: formatMs(m.p99),
            errorRate: formatPercent(m.errorRate),
          };
          return (
            <tr
              key={id}
              data-region-id={id}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <th
                scope="row"
                className="max-w-0 truncate py-0.5 pr-2 text-left font-normal"
                title={`${m.name}: ${m.users.toLocaleString('en-US')} users`}
              >
                {m.name}
              </th>
              {cols.map(([field, h]) => (
                <td key={field} className="py-0.5 text-right" data-col={field}>
                  <FormulaValue
                    label={`${h} for ${m.name}`}
                    formula={regionFormula(field, m)}
                    className={
                      field === 'p50'
                        ? 'font-semibold'
                        : field === 'errorRate' && m.errorRate > 0.001
                          ? 'text-red-600 dark:text-red-400'
                          : ''
                    }
                  >
                    {values[field]}
                  </FormulaValue>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Bottlenecks({
  result,
  labelOf,
}: {
  result: SimResult;
  labelOf: (id: string) => string | undefined;
}) {
  const board = useBoardStoreApi();
  const sim = useSimulationStoreApi();
  const rows = bottleneckRows(result, labelOf);
  return (
    <div>
      <h3 className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
        Bottlenecks
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">None: every service is below 85% utilisation.</p>
      ) : (
        <ul className="space-y-0.5" data-testid="bottlenecks">
          {rows.map((r) => (
            <li key={r.nodeId}>
              <button
                type="button"
                onClick={() => {
                  board.getState().setSelection([r.nodeId]);
                  sim.getState().requestFocus(r.nodeId);
                }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:hover:bg-slate-800"
                title={`Select and focus on the canvas.\nUtilisation: ${r.formula}`}
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${utilizationLevel(r.utilization) === 'hot' ? 'bg-red-600' : 'bg-amber-500'}`}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                <span className="tabular-nums text-slate-600 dark:text-slate-300">
                  {formatPercent(r.utilization)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SEVERITY_STYLE: Record<Finding['severity'], string> = {
  info: 'text-slate-500',
  warning: 'text-amber-700 dark:text-amber-300',
  error: 'text-red-700 dark:text-red-300',
  critical: 'text-red-700 dark:text-red-300 font-semibold',
};

function Findings({ findings }: { findings: readonly Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
        Simulation notes
      </h3>
      <ul className="space-y-0.5 text-xs">
        {findings.map((f, i) => (
          <li key={`${f.ruleId}-${i}`} className={SEVERITY_STYLE[f.severity]} title={f.message}>
            <span className="capitalize">{f.severity}</span>: {f.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
