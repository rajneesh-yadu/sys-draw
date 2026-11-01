/**
 * S12: what the board's cloud provider means for this node — product, price table date, service
 * limits (marked when the simulation finds them exceeded) and a warning when the provider has no
 * equivalent. All data comes from the provider's registry entry.
 */
import { TriangleAlert } from 'lucide-react';
import {
  componentDisplayName,
  isAvailableOn,
  providerService,
  registry,
  serviceLimits,
  type EntryByKind,
} from '@/registry';
import { useSimulationStore, type NodeInstance, type ProviderId } from '@/store';
import { Section } from './common';

export function ProviderInfo({
  def,
  node,
  providerId,
}: {
  def: EntryByKind['component'];
  node: NodeInstance;
  providerId: ProviderId;
}) {
  const provider = registry.get(providerId, 'provider');
  const findings = useSimulationStore((s) => s.result?.findings);
  if (!provider || provider.id === 'generic') return null;
  const available = isAvailableOn(def, providerId);
  const svc = providerService(provider, def.id);
  const limits = serviceLimits(provider, def.id, node.config);
  const exceeded = new Set(
    (findings ?? [])
      .filter((f) => f.ruleId === 'engine.limits' && f.targetIds.includes(node.id))
      .map((f) => f.title),
  );

  return (
    <Section title={`On ${provider.shortName}`}>
      <div data-testid="provider-info" className="space-y-2 text-xs">
        {!available ? (
          <p
            role="alert"
            className="flex gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {def.name} has no {provider.shortName} equivalent. It keeps its own model and prices;
              replace it to make the design deployable on {provider.shortName}.
            </span>
          </p>
        ) : (
          <p className="text-slate-600 dark:text-slate-300">
            {componentDisplayName(def, providerId)}
            {svc?.note ? ` — ${svc.note}` : ''}
          </p>
        )}
        <p className="text-slate-500 dark:text-slate-400">
          Prices: {provider.shortName} list prices in {provider.pricing.region}, as of{' '}
          {provider.pricing.asOf} (approximate).
        </p>
        {limits.length > 0 && (
          <ul aria-label={`${provider.shortName} limits`} className="space-y-1">
            {limits.map((l) => {
              const over = exceeded.has(`${provider.shortName} limit: ${l.label}`);
              return (
                <li
                  key={l.id}
                  data-limit-id={l.id}
                  data-exceeded={over || undefined}
                  className={`rounded border px-2 py-1 ${
                    over
                      ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{l.label}</span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {l.value.toLocaleString('en-US')} {l.unit}
                    </span>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">
                    {l.adjustable ? 'Default quota (can be raised)' : 'Hard limit'}
                    {over && (
                      <span className="ml-1 font-semibold text-amber-800 dark:text-amber-200">
                        · Exceeded
                      </span>
                    )}
                  </div>
                  {l.note && <div className="text-slate-500 dark:text-slate-400">{l.note}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
