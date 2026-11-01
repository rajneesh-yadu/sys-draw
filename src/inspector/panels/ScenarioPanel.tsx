/**
 * Board panel (nothing selected): the scenario editor — users per region on a world map (S10),
 * daily cycle, peak multiplier, payloads. Flows and chaos events come later.
 */
import { registry } from '@/registry';
import { ScenarioSchema, type ProviderId, type Scenario } from '@/store';
import type { FieldOverrides } from '../form/model';
import { SchemaForm } from '../form/SchemaForm';
import { UsersMap } from '../geo/UsersMap';
import { ProviderDocs } from './DocsView';
import { PanelTitle, Section, Tabs } from './common';
import { useDispatch } from './use-dispatch';

const BasicScenarioSchema = ScenarioSchema.pick({
  peakMultiplier: true,
  diurnal: true,
  payloadBytes: true,
  durationSec: true,
  seed: true,
});

const SCENARIO_OVERRIDES: FieldOverrides = {
  peakMultiplier: {
    label: 'Peak multiplier',
    unit: '×',
    help: 'Spike on top of the daily peak (peak ÷ average traffic); costs use the average',
  },
  diurnal: {
    label: 'Daily cycle',
    help: 'Each region follows its own day and night (busiest at 20:00 local); the run checks the busiest moment worldwide. Off = every region at its peak at once',
  },
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
    <>
      <Section title="Users">
        <UsersMap
          usersByRegion={scenario.usersByRegion}
          providerId={providerId}
          onCommit={(usersByRegion) =>
            dispatch({ type: 'updateScenario', patch: { usersByRegion } })
          }
        />
      </Section>
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
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {scenario.flows.length} flow{scenario.flows.length === 1 ? '' : 's'} and{' '}
          {scenario.events.length} chaos event{scenario.events.length === 1 ? '' : 's'} — edited in
          the scenario editor (later session).
        </p>
      </Section>
    </>
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
