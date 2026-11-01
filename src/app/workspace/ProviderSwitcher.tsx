/**
 * S12: the board's cloud provider picker. Choosing another provider shows what will change
 * (product names, regions moved, components with no equivalent, limits that now apply, price
 * table date) and switches with one undoable `setProvider` command.
 */
import { Cloud, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { planProviderSwitch, registry, type ProviderSwitchPlan } from '@/registry';
import { useBoardStore, useBoardStoreApi, type ProviderId } from '@/store';
import { useNotice } from './notice-context';

const ORDER: ProviderId[] = ['generic', 'aws', 'gcp', 'azure'];

function providerLabel(id: ProviderId): string {
  return registry.get(id, 'provider')?.shortName ?? id;
}

/** Same rename counted once: "Object Storage → S3 (2)". */
function renameLines(plan: ProviderSwitchPlan): string[] {
  const counts = new Map<string, number>();
  for (const r of plan.relabels) {
    if (r.from === r.to) continue;
    const k = `${r.from} → ${r.to}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (n > 1 ? `${k} (${n})` : k));
}

export function ProviderSwitcher() {
  const api = useBoardStoreApi();
  const current = useBoardStore((s) => s.doc.providerId);
  const graph = useBoardStore((s) => s.doc.graph);
  const scenario = useBoardStore((s) => s.doc.scenario);
  const [target, setTarget] = useState<ProviderId | null>(null);
  const { show } = useNotice();
  const root = useRef<HTMLDivElement>(null);
  const providers = useMemo(
    () =>
      registry
        .list({ kind: 'provider' })
        .map((p) => p.id)
        .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)),
    [],
  );
  const plan = useMemo(
    () => (target ? planProviderSwitch(registry, graph, scenario, current, target) : null),
    [target, graph, scenario, current],
  );

  useEffect(() => {
    if (!target) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setTarget(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [target]);

  const apply = (to: ProviderId, p: ProviderSwitchPlan | null) => {
    const r = api.getState().dispatch({ type: 'setProvider', providerId: to });
    setTarget(null);
    if (!r.ok) {
      show({ kind: 'error', text: r.reason });
      return;
    }
    const warn = p?.noEquivalent.length ?? 0;
    show({
      kind: 'info',
      text:
        `Switched to ${providerLabel(to)}.` +
        (warn > 0 ? ` ${warn} component${warn === 1 ? ' has' : 's have'} no equivalent.` : '') +
        ' Undo with Ctrl+Z.',
    });
  };

  const choose = (to: ProviderId) => {
    if (to === current) return;
    const p = planProviderSwitch(registry, graph, scenario, current, to);
    const nothingToReview =
      p.relabels.length === 0 && p.regions.length === 0 && p.noEquivalent.length === 0;
    if (nothingToReview) apply(to, p);
    else setTarget(to);
  };

  const toName = target ? providerLabel(target) : '';
  const toEntry = target ? registry.get(target, 'provider') : undefined;
  const renames = plan ? renameLines(plan) : [];

  return (
    <div ref={root} className="relative flex items-center gap-1.5">
      <Cloud size={14} aria-hidden className="text-slate-500 dark:text-slate-400" />
      <label className="sr-only" htmlFor="board-provider">
        Cloud provider
      </label>
      <select
        id="board-provider"
        data-testid="provider-select"
        value={target ?? current}
        onChange={(e) => choose(e.target.value as ProviderId)}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
      >
        {providers.map((id) => (
          <option key={id} value={id}>
            {providerLabel(id)}
          </option>
        ))}
      </select>
      {target && plan && (
        <div
          role="dialog"
          aria-label={`Switch to ${toName}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setTarget(null);
            }
          }}
          className="absolute top-full right-0 z-50 mt-1 w-96 space-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <p className="text-sm font-semibold">Switch this board to {toEntry?.name ?? toName}?</p>
          {renames.length > 0 && (
            <div>
              <p className="font-medium">Renamed</p>
              <ul className="list-disc pl-4" data-testid="switch-renames">
                {renames.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.regions.length > 0 && (
            <div>
              <p className="font-medium">Regions</p>
              <ul className="list-disc pl-4" data-testid="switch-regions">
                {plan.regions.map((r) => (
                  <li key={`${r.targetId}:${r.from}`}>
                    {r.label}: {r.from} → {r.to ?? 'no region (kept)'}
                    {r.nearest ? ` (nearest: ${toName} has no region in that metro)` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.noEquivalent.length > 0 && (
            <div
              role="alert"
              data-testid="switch-warnings"
              className="space-y-1 rounded bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              {plan.noEquivalent.map((w) => (
                <p key={w.targetId} className="flex gap-1.5">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <strong>{w.label}</strong>: {w.message}
                  </span>
                </p>
              ))}
            </div>
          )}
          {plan.limits.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">
                {toName} limits that will be checked ({plan.limits.length} component
                {plan.limits.length === 1 ? '' : 's'})
              </summary>
              <ul className="list-disc pl-4">
                {plan.limits.map((l) => (
                  <li key={l.nodeId}>
                    {l.label}: {l.limits.join('; ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {toEntry && (
            <p className="text-slate-500 dark:text-slate-400">
              Prices: {toName} list prices in {toEntry.pricing.region}, as of {toEntry.pricing.asOf}{' '}
              (approximate).
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => apply(target, plan)}
              className="rounded bg-sky-600 px-2 py-0.5 font-medium text-white hover:bg-sky-700"
            >
              Switch to {toName}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
