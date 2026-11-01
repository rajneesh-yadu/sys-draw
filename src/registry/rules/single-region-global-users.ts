/**
 * S19 design review: users on several continents (≥ 2 user regions ≥ 3 000 km apart, each with ≥
 * 10 % of users) while every placed service runs in one cloud region. Needs the scenario and
 * services placed in Region groups (unplaced boards have no geography to judge). No automatic fix.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, isComputeDef, regionOf, round } from '../design-tools';
import { userRegion } from '../geo/user-regions';

const ID = 'rule.single-region-global-users';
const MIN_SHARE = 0.1;
const FAR_KM = 3000;

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export default defineRule({
  id: ID,
  title: 'Global users served from one region',
  category: 'performance',
  severity: 'warning',
  tags: ['geo', 'multi-region', 'latency', 'global'],
  appliesTo: { categories: ['compute'], needs: ['scenario'] },
  check: (ctx) => {
    const users = ctx.scenario?.usersByRegion ?? {};
    const total = Object.values(users).reduce((a, b) => a + b, 0);
    if (total <= 0) return [];
    const big = Object.entries(users)
      .filter(([, u]) => u / total >= MIN_SHARE)
      .map(([id, u]) => ({ id, u, r: userRegion(id) }))
      .filter((x) => x.r !== undefined);
    let far = false;
    for (const a of big) for (const b of big) if (km(a.r!, b.r!) >= FAR_KM) far = true;
    if (!far) return [];
    const services = ctx.graph.nodes.filter((n) => isComputeDef(defOf(ctx, n)));
    const regions = new Set(
      services.map((n) => regionOf(ctx.graph, n)).filter((r): r is string => r !== undefined),
    );
    if (regions.size !== 1) return [];
    const only = [...regions][0]!;
    const worst = Object.values(ctx.result?.perRegion ?? {}).sort((a, b) => b.p50 - a.p50)[0];
    const out: Finding[] = [
      {
        ruleId: ID,
        severity: 'warning',
        title: `Users on ${big.length} continents, servers only in ${only}`,
        message: `${big.map((x) => `${x.r!.name} ${round((x.u / total) * 100)} %`).join(', ')} — but every service runs in ${only}. Users far from it pay one or more ocean-crossing round trips (100–250 ms each) per request${worst ? `; ${worst.name} sees p50 ${round(worst.p50)} ms` : ''}, and a regional outage takes everyone down.`,
        targetIds: services.filter((n) => regionOf(ctx.graph, n) === only).map((n) => n.id),
        fix: 'Deploy the stateless tiers in a second region near the other users, route with geo-DNS / anycast, put a CDN in front, and replicate the data (read replicas or a global database).',
      },
    ];
    return out;
  },
  docs: {
    summary: 'Flags boards whose users span continents while all services sit in one region.',
    why: 'Light in fibre covers ~200 km per ms; a request from Mumbai to us-east-1 spends ~200 ms on the network before any work happens, and every extra sequential round trip adds it again.',
    howToFix:
      'Serve users from the nearest region (geo-DNS, anycast load balancing), cache at the edge with a CDN, and replicate data across regions — read locally, write to a home region or use a multi-region database.',
  },
});
