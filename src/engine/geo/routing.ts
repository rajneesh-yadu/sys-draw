/**
 * Geo step — routing to the nearest healthy region (geo-DNS / global LB / CDN origin choice) and
 * where each visited node is for one user region's requests.
 *
 * - A client, or a node whose behavior `geoRoutes` (load balancer, CDN), with targets in two or
 *   more cloud regions sends each request to ONE region: nearest healthy by RTT from where it is
 *   (a client's DNS can change the policy: failover / weighted). Targets with no region are
 *   always called.
 * - Reads from any node to the same kind of data store in several regions go to the nearest
 *   healthy copy (read-local replicas).
 * - Unplaced nodes are where their caller is (an app server in no region group runs next to
 *   whatever calls it).
 */
import { behaviorsOf, type Call, type GeoPolicy } from '../behaviors';
import { isDataStore } from '../model/compile';
import { engineFinding } from '../model/findings';
import type { Finding } from '@/core';
import type { CompiledNode, Op } from '../model/types';
import { netBetween, type Place } from './distance';
import { edgePlace, type GeoModel } from './places';

/** Routing context for one user region's requests. */
export interface GeoWalk {
  geo: GeoModel;
  /** The user region's place; undefined when its location is unknown. */
  user: Place | undefined;
  /** Findings raised while routing (deduplicated by the caller). */
  issues: Finding[];
}

export function placeOf(
  node: CompiledNode,
  caller: Place | undefined,
  ctx: GeoWalk,
): Place | undefined {
  if (node.kind === 'source') return ctx.user;
  const fixed = ctx.geo.nodePlace.get(node.id);
  if (fixed) return fixed;
  if (ctx.user && behaviorsOf(node.behaviors).some((b) => b.placement === 'edge')) {
    return edgePlace(ctx.user);
  }
  return caller;
}

export interface CallOption {
  p: number;
  calls: Call[];
}

function regionOfTarget(c: Call, ctx: GeoWalk): Place | undefined {
  return ctx.geo.nodePlace.get(c.target.id);
}

function dnsPolicyOf(node: CompiledNode, calls: readonly Call[]): GeoPolicy {
  for (const c of calls) {
    for (const b of behaviorsOf(c.target.behaviors)) {
      const p = b.dnsPolicy?.(c.target);
      if (p !== undefined) return p;
    }
  }
  for (const b of behaviorsOf(node.behaviors)) {
    const p = b.dnsPolicy?.(node);
    if (p !== undefined) return p;
  }
  return 'latency';
}

/**
 * Splits `calls` into region choices. Returns undefined when nothing geo applies (keep calling
 * every target as before).
 */
export function selectCalls(
  node: CompiledNode,
  here: Place | undefined,
  op: Op,
  calls: readonly Call[],
  ctx: GeoWalk,
): CallOption[] | undefined {
  if (!ctx.geo.active || calls.length < 2) return undefined;
  const geoRoutes =
    node.kind === 'source' || behaviorsOf(node.behaviors).some((b) => b.geoRoutes === true);

  if (geoRoutes) {
    const byRegion = new Map<string, { place: Place; calls: Call[]; order: number }>();
    const rest: Call[] = [];
    calls.forEach((c, i) => {
      const r = regionOfTarget(c, ctx);
      if (!r) return void rest.push(c);
      const g = byRegion.get(r.id);
      if (g) g.calls.push(c);
      else byRegion.set(r.id, { place: r, calls: [c], order: i });
    });
    if (byRegion.size < 2) return undefined;
    const regions = [...byRegion.values()];
    const healthy = regions.filter((r) => !ctx.geo.unhealthy.has(r.place.id));
    const policy = node.kind === 'source' ? dnsPolicyOf(node, calls) : 'latency';
    const rtt = (r: { place: Place }) => netBetween(here, r.place).ms;
    const nearest = (list: typeof regions) =>
      [...list].sort((a, b) => rtt(a) - rtt(b) || a.order - b.order)[0];
    const pool = healthy.length > 0 ? healthy : regions;
    if (healthy.length === 0) {
      ctx.issues.push(
        engineFinding(
          'engine.route',
          'error',
          'Every region is down',
          `"${node.label}" can reach ${regions.map((r) => r.place.id).join(', ')}, but all are in an outage; requests still go to the nearest one.`,
          [node.id],
        ),
      );
    }
    let picked: { place: Place; calls: Call[]; order: number }[];
    if (policy === 'weighted' || policy === 'simple') picked = pool;
    else if (policy === 'failover') picked = [[...pool].sort((a, b) => a.order - b.order)[0]!];
    else picked = [nearest(pool)!];
    const best = nearest(regions);
    if (healthy.length > 0 && best && ctx.geo.unhealthy.has(best.place.id) && picked[0]) {
      ctx.issues.push(
        engineFinding(
          'engine.route',
          'warning',
          'Region failover',
          `${ctx.user?.name ?? 'Users'}: ${best.place.id} is down, so "${node.label}" sends them to ${picked.map((p) => p.place.id).join(', ')} instead.`,
          [node.id],
        ),
      );
    }
    return picked.map((r) => ({ p: 1 / picked.length, calls: [...rest, ...r.calls] }));
  }

  if (op !== 'read') return undefined;
  // Read-local: the same data store kind in several regions ⇒ read the nearest healthy copy.
  const groups = new Map<string, Call[]>();
  for (const c of calls) {
    if (!c.edge.sync || !isDataStore(c.target) || !regionOfTarget(c, ctx)) continue;
    groups.set(c.target.defId, [...(groups.get(c.target.defId) ?? []), c]);
  }
  const drop = new Set<Call>();
  for (const list of groups.values()) {
    const regions = new Set(list.map((c) => regionOfTarget(c, ctx)?.id));
    if (regions.size < 2) continue;
    const ok = list.filter((c) => !ctx.geo.unhealthy.has(regionOfTarget(c, ctx)?.id ?? ''));
    const pool = ok.length > 0 ? ok : list;
    const keep = [...pool].sort(
      (a, b) =>
        netBetween(here, regionOfTarget(a, ctx)).ms - netBetween(here, regionOfTarget(b, ctx)).ms,
    )[0];
    for (const c of list) if (c !== keep) drop.add(c);
  }
  if (drop.size === 0) return undefined;
  return [{ p: 1, calls: calls.filter((c) => !drop.has(c)) }];
}
