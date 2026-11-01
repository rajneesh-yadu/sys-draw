/** Chaos: one-click failures, the verdict over the timeline and recovery markers. */
import { Zap } from 'lucide-react';
import { useBoardStoreApi } from '@/store';
import { CHAOS_PRESETS, chaosVerdict, injectCommand } from '../chaos';
import type { ChaosState } from '../controllers/chaos';
import { formatSloValue } from '../evaluate';
import type { ModeContext } from '../types';
import { Checks } from './Checks';
import { banner, button, sectionTitle } from './styles';

export function ChaosPanel({
  state,
  ctx,
  onError,
}: {
  state: ChaosState;
  ctx: ModeContext;
  onError: (msg: string) => void;
}) {
  const board = useBoardStoreApi();
  const v = chaosVerdict(ctx);
  const inject = (presetId: string) => {
    const used = new Set(ctx.scenario.events.map((e) => e.id));
    let n = 1;
    while (used.has(`evt_chaos-${presetId}-${n}`)) n++;
    const id = `evt_chaos-${presetId}-${n}`;
    const r = injectCommand(presetId, ctx.graph, ctx.scenario, id);
    if (!r.ok) return onError(r.reason);
    const res = board.getState().dispatch(r.command);
    if (!res.ok) onError(res.reason);
  };
  return (
    <div className="space-y-3" data-testid="chaos-panel">
      {state.passedAtMs !== undefined && (
        <p className={banner} role="status">
          Experiment passed — the design stayed within its targets.
        </p>
      )}
      <section className="space-y-1.5" aria-label="Inject a failure">
        <h3 className={sectionTitle}>Inject a failure</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {CHAOS_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={button}
              title={p.description}
              onClick={() => inject(p.id)}
            >
              <Zap className="h-3.5 w-3.5" aria-hidden /> {p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {v.events} failure{v.events === 1 ? '' : 's'} scheduled. Edit or remove them in the
          Metrics drawer’s Failures tab; replay the timeline there.
        </p>
        {v.events > 0 && (
          <button
            type="button"
            className={button}
            onClick={() =>
              board.getState().dispatch({ type: 'updateScenario', patch: { events: [] } })
            }
          >
            Clear all failures
          </button>
        )}
      </section>
      <section className="space-y-1.5" aria-label="Verdict">
        <h3 className={sectionTitle}>Verdict</h3>
        <p className="text-xs" data-testid="chaos-summary">
          {v.summary}
        </p>
        {v.minAvailability !== undefined && (
          <Checks
            label="Targets"
            items={[
              {
                label: `Availability ≥ ${formatSloValue('availability', v.targets.availability)}`,
                ok: v.availabilityOk,
                detail: `lowest ${formatSloValue('availability', v.minAvailability)}`,
              },
              {
                label: `p99 ≤ ${formatSloValue('p99', v.targets.p99Ms)}`,
                ok: v.p99Ok,
                detail: `worst ${formatSloValue('p99', v.maxP99Ms ?? 0)}`,
              },
            ]}
          />
        )}
        {v.recoverySec !== undefined && v.recoverySec > 0 && (
          <p className="text-xs">Recovered {v.recoverySec} s after the last failure ended.</p>
        )}
        {v.markers.length > 0 && (
          <ul
            className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300"
            aria-label="Timeline events"
          >
            {v.markers.slice(0, 8).map((m, k) => (
              <li key={`${m.tSec}-${k}`}>
                <span className="tabular-nums text-slate-500 dark:text-slate-400">{m.tSec}s</span> ·{' '}
                {m.label}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
