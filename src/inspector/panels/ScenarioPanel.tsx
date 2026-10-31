/** Board panel (nothing selected): the basic scenario knobs. Flows and chaos events come later. */
import { registry } from '@/registry';
import { ScenarioSchema, type ProviderId, type Scenario } from '@/store';
import type { FieldOverrides } from '../form/model';
import { SchemaForm } from '../form/SchemaForm';
import { ProviderDocs } from './DocsView';
import { PanelTitle, Section, Tabs } from './common';
import { useDispatch } from './use-dispatch';

const BasicScenarioSchema = ScenarioSchema.pick({
  usersByRegion: true,
  peakMultiplier: true,
  diurnal: true,
  payloadBytes: true,
  durationSec: true,
  seed: true,
});

const SCENARIO_OVERRIDES: FieldOverrides = {
  usersByRegion: {
    label: 'Users by region',
    help: 'Concurrent users per user region (e.g. north-america, europe, india)',
    defaultValue: 1000,
  },
  'usersByRegion.*': { unit: 'users', defaultValue: 1000 },
  peakMultiplier: { label: 'Peak multiplier', unit: '×', help: 'Peak traffic ÷ average traffic' },
  diurnal: { label: 'Daily cycle', help: 'Traffic follows each region’s day and night' },
  payloadBytes: { label: 'Payload size' },
  'payloadBytes.req': { label: 'Request', unit: 'bytes' },
  'payloadBytes.res': { label: 'Response', unit: 'bytes' },
  durationSec: { label: 'Simulated duration' },
  seed: { advanced: true, label: 'Random seed', help: 'Same seed → same results' },
};

export function ScenarioPanel({
  scenario,
  providerId,
}: {
  scenario: Scenario;
  providerId: ProviderId;
}) {
  const dispatch = useDispatch();
  const provider = registry.get(providerId, 'provider');

  const settings = (
    <Section title="Scenario">
      <SchemaForm
        label="Scenario"
        schema={BasicScenarioSchema}
        value={scenario as unknown as Record<string, unknown>}
        overrides={SCENARIO_OVERRIDES}
        onCommit={(patch) =>
          dispatch({ type: 'updateScenario', patch: patch as Partial<Scenario> })
        }
      />
      <p className="text-xs text-slate-500">
        {scenario.flows.length} flow{scenario.flows.length === 1 ? '' : 's'} and{' '}
        {scenario.events.length} chaos event{scenario.events.length === 1 ? '' : 's'} — edited in
        the scenario editor (later session).
      </p>
    </Section>
  );

  return (
    <div>
      <div className="px-3 pt-3">
        <PanelTitle title="Board" subtitle="Select a node, connection or group to configure it." />
      </div>
      <Tabs
        tabs={[
          { id: 'settings', label: 'Settings', content: settings },
          {
            id: 'docs',
            label: 'Docs',
            content: provider ? (
              <ProviderDocs def={provider} />
            ) : (
              <p className="text-xs">No provider docs.</p>
            ),
          },
        ]}
      />
    </div>
  );
}
