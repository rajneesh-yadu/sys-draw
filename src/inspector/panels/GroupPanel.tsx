/** Group panel: label, kind, region and security (public flag + firewall rules). */
import { useMemo } from 'react';
import { componentDisplayName, registry } from '@/registry';
import {
  GROUP_KINDS,
  GroupSchema,
  descendantsOf,
  groupKindLabel,
  type Graph,
  type Group,
  type GroupKind,
  type ProviderId,
} from '@/store';
import type { FieldOverrides } from '../form/model';
import { SchemaForm } from '../form/SchemaForm';
import { PanelTitle, Section, Tabs } from './common';
import { useDispatch } from './use-dispatch';

const GroupFormSchema = GroupSchema.pick({
  label: true,
  kind: true,
  regionId: true,
  security: true,
});

export function GroupPanel({
  group,
  graph,
  providerId,
}: {
  group: Group;
  graph: Graph;
  providerId: ProviderId;
}) {
  const dispatch = useDispatch();
  const provider = registry.get(providerId, 'provider');

  const overrides = useMemo<FieldOverrides>(
    () => ({
      kind: { options: GROUP_KINDS.map((k) => ({ value: k, label: groupKindLabel(k) })) },
      regionId: {
        label: 'Region',
        help: 'Cloud region this group runs in',
        ...(provider
          ? {
              options: provider.regions.map((r) => ({ value: r.id, label: `${r.name} (${r.id})` })),
            }
          : {}),
      },
      security: {
        label: 'Security',
        help: 'Network exposure and firewall (security group) rules',
        defaultValue: { public: false, firewallRules: [] },
      },
      'security.public': { label: 'Public (reachable from the internet)' },
      'security.firewallRules': { label: 'Firewall rules' },
      'security.firewallRules.*': {
        defaultValue: {
          direction: 'ingress',
          action: 'allow',
          protocol: 'tcp',
          fromPort: 443,
          toPort: 443,
          peer: 'internet',
        },
      },
      'security.firewallRules.*.peer': { help: 'CIDR (10.0.0.0/16), a group id, or "internet"' },
      'security.firewallRules.*.fromPort': { label: 'From port' },
      'security.firewallRules.*.toPort': { label: 'To port' },
    }),
    [provider],
  );

  const members = descendantsOf(graph, group.id);
  const memberNodes = graph.nodes.filter((n) => members.nodeIds.has(n.id));

  const settings = (
    <Section title="Basic">
      <SchemaForm
        label="Group settings"
        schema={GroupFormSchema}
        value={group as unknown as Record<string, unknown>}
        overrides={overrides}
        onCommit={(p) => {
          if ('label' in p)
            return dispatch({ type: 'updateGroup', groupId: group.id, label: String(p.label) });
          if ('kind' in p)
            return dispatch({ type: 'updateGroup', groupId: group.id, kind: p.kind as GroupKind });
          if ('regionId' in p) {
            return dispatch({
              type: 'updateGroup',
              groupId: group.id,
              regionId: (p.regionId as string | undefined) ?? null,
            });
          }
          return dispatch({
            type: 'updateGroup',
            groupId: group.id,
            security: (p.security as NonNullable<Group['security']> | undefined) ?? null,
          });
        }}
      />
    </Section>
  );

  const docs = (
    <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
      <p>
        {groupKindLabel(group.kind)} with {memberNodes.length} component
        {memberNodes.length === 1 ? '' : 's'}
        {members.groupIds.size > 0 ? ` and ${members.groupIds.size} nested group(s)` : ''}.
      </p>
      <ul className="space-y-1.5">
        {memberNodes.map((n) => {
          const def = registry.get(n.defId, 'component');
          return (
            <li key={n.id}>
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {n.label}
                {def ? ` (${componentDisplayName(def, providerId)})` : ''}
              </span>
              {def ? ` — ${def.docs.summary}` : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div>
      <div className="px-3 pt-3">
        <PanelTitle title={group.label} subtitle={groupKindLabel(group.kind)} />
      </div>
      <Tabs
        tabs={[
          { id: 'settings', label: 'Settings', content: settings },
          { id: 'docs', label: 'Docs', content: docs },
        ]}
      />
    </div>
  );
}
