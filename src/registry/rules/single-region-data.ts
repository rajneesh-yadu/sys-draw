/** S16 threat check: all critical data in one region (a regional outage or disaster loses it). */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { ancestorGroupIds, isDataStore } from '../security-tools';

const ID = 'rule.single-region-data';

export default defineRule({
  id: ID,
  title: 'Critical data in a single region',
  category: 'security',
  severity: 'warning',
  tags: ['availability', 'disaster-recovery', 'regions'],
  check: (ctx) => {
    const { graph } = ctx;
    const regionGroups = graph.groups.filter((g) => g.kind === 'region' && g.regionId);
    if (regionGroups.length === 0) return [];
    const regionOf = (groupId: string | undefined) =>
      ancestorGroupIds(graph, groupId)
        .map((id) => graph.groups.find((g) => g.id === id))
        .find((g) => g?.kind === 'region' && g.regionId)?.regionId;
    const stores = graph.nodes.filter(
      (n) =>
        ctx.components.get(n.defId)?.category === 'database' &&
        isDataStore(ctx.components.get(n.defId)),
    );
    if (stores.length === 0) return [];
    const regions = new Set(stores.map((n) => regionOf(n.groupId)).filter((r) => r !== undefined));
    if (regions.size > 1) return [];
    const only = [...regions][0];
    const out: Finding[] = [
      {
        ruleId: ID,
        severity: 'warning',
        title: only ? `All databases are in ${only}` : 'Databases are not placed in any region',
        message: `${stores.length === 1 ? 'The only database' : `All ${stores.length} databases`} ${only ? `live in ${only}` : 'sit outside every region group'}: a regional outage, a ransomware incident or a deleted account takes all of the data with it.`,
        targetIds: stores.map((n) => n.id),
        fix: 'Replicate (or back up) critical data to a second region: a cross-region read replica, global table or backups copied to another region and account.',
      },
    ];
    return out;
  },
  docs: {
    summary: 'Warns when every database on a multi-region board sits in one region.',
    why: 'Availability is part of security (the "A" in CIA). One region failing, or one compromised account deleting it, should not lose all data.',
    howToFix:
      'Add a replica or backup copy in another region (and ideally another account), and test restoring from it.',
  },
});
