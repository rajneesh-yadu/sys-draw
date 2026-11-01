/** Node panel: label, generated component config (Basic / Advanced) and scaling (+ quick actions). */
import { useMemo } from 'react';
import { z } from 'zod';
import { componentDisplayName, instancePrice, registry } from '@/registry';
import { NodeScalingSchema, type NodeInstance, type ProviderId } from '@/store';
import type { FieldOverrides } from '../form/model';
import { SchemaForm } from '../form/SchemaForm';
import { ComponentDocs } from './DocsView';
import { PanelTitle, Section, Tabs } from './common';
import { ProviderInfo } from './ProviderInfo';
import { ScaleActions } from './ScaleActions';
import { useDispatch } from './use-dispatch';

const LabelSchema = z.object({
  label: z.string().trim().min(1).describe('Name shown on the canvas'),
});

export function NodePanel({ node, providerId }: { node: NodeInstance; providerId: ProviderId }) {
  const dispatch = useDispatch();
  const def = registry.get(node.defId, 'component');

  const scalingOverrides = useMemo<FieldOverrides>(
    () => ({
      replicas: { help: 'Identical instances behind a load balancer (scale out)' },
      instanceType: {
        label: 'Instance type',
        help: 'Size of each instance (scale up)',
        options: (def?.instanceTypes ?? []).map((t) => {
          // S12: the board provider's product and price for this size, when it has one.
          const p = instancePrice(registry.get(providerId, 'provider'), def?.id ?? '', t.id);
          return {
            value: t.id,
            label: p
              ? `${t.id} — ${p.name} · ${t.vCpu} vCPU · ${t.memGb} GB · $${+p.costUsdPerHour.toFixed(4)}/h`
              : `${t.id} — ${t.vCpu} vCPU · ${t.memGb} GB · $${t.costUsdPerHour}/h`,
          };
        }),
      },
      autoscale: {
        label: 'Autoscale',
        help: 'Add or remove replicas to hold a target utilisation',
        defaultValue: {
          min: node.scaling.replicas,
          max: node.scaling.replicas * 4,
          targetUtil: 0.6,
          warmupSec: 60,
        },
      },
      'autoscale.min': { label: 'Min replicas' },
      'autoscale.max': { label: 'Max replicas' },
      'autoscale.targetUtil': {
        label: 'Target utilisation',
        unit: '0–1',
        step: 0.05,
        help: 'Scale out above this busy fraction',
      },
      'autoscale.warmupSec': { label: 'Warm-up', help: 'Time before a new replica takes traffic' },
    }),
    [def, node.scaling.replicas, providerId],
  );

  if (!def) {
    return (
      <p className="p-3 text-sm text-red-600">
        Unknown component “{node.defId}” — its registry file may have been removed.
      </p>
    );
  }

  const settings = (
    <>
      <ProviderInfo def={def} node={node} providerId={providerId} />
      <Section title="Basic">
        <SchemaForm
          label="Node name"
          schema={LabelSchema}
          value={{ label: node.label }}
          onCommit={(p) =>
            dispatch({ type: 'updateNode', nodeId: node.id, label: String(p.label ?? '') })
          }
        />
        <SchemaForm
          label={`${def.name} configuration`}
          schema={def.configSchema}
          value={node.config}
          sections={['basic']}
          onCommit={(config) => dispatch({ type: 'updateConfig', nodeId: node.id, config })}
        />
      </Section>
      <Section title="Scaling">
        <ScaleActions def={def} node={node} />
        <SchemaForm
          label="Scaling"
          schema={NodeScalingSchema}
          value={node.scaling}
          overrides={scalingOverrides}
          onCommit={(p) => {
            const { autoscale, ...rest } = p;
            return dispatch({
              type: 'updateNode',
              nodeId: node.id,
              scaling: {
                ...(rest as { replicas?: number; instanceType?: string }),
                ...('autoscale' in p
                  ? {
                      autoscale: (autoscale ?? null) as NonNullable<
                        NodeInstance['scaling']['autoscale']
                      > | null,
                    }
                  : {}),
              },
            });
          }}
        />
      </Section>
      <SchemaForm
        label={`${def.name} advanced configuration`}
        schema={def.configSchema}
        value={node.config}
        sections={['advanced']}
        onCommit={(config) => dispatch({ type: 'updateConfig', nodeId: node.id, config })}
      />
    </>
  );

  return (
    <div>
      <div className="px-3 pt-3">
        <PanelTitle
          title={componentDisplayName(def, providerId)}
          subtitle={`${node.label} · ${def.id}`}
        />
      </div>
      <Tabs
        tabs={[
          { id: 'settings', label: 'Settings', content: settings },
          { id: 'docs', label: 'Docs', content: <ComponentDocs def={def} /> },
        ]}
      />
    </div>
  );
}
