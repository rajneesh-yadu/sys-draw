/**
 * Geo step — where things are. Cloud regions come from the board's provider entry (registry
 * `providers/*.ts` → `regions`, falling back to the generic provider); user regions from the
 * registry's USER_REGIONS table. A node's place is its enclosing region group's region.
 *
 * Geo is ACTIVE only when at least one node sits in a known cloud region. Otherwise every hop is
 * 0 ms, exactly as before S10: distance only means something once you place servers somewhere.
 */
import type { Finding, ProviderId, Scenario } from '@/core';
import { userRegion, type ProviderDefinition } from '@/registry';
import type { ComponentSource } from '../model/compile';
import { engineFinding } from '../model/findings';
import type { Model } from '../model/types';
import type { Place } from './distance';

export interface GeoModel {
  active: boolean;
  /** Resolved cloud place per node id (only nodes in a known region). */
  nodePlace: ReadonlyMap<string, Place>;
  /** Cloud regions that are down (region / region-group outage events). */
  unhealthy: ReadonlySet<string>;
  issues: Finding[];
}

export function cloudPlace(r: { id: string; name: string; lat: number; lon: number }): Place {
  return {
    key: `cloud:${r.id}`,
    kind: 'cloud',
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    lastMileMs: 0,
  };
}

export function userPlace(regionId: string): Place | undefined {
  const r = userRegion(regionId);
  return r
    ? {
        key: `user:${r.id}`,
        kind: 'user',
        id: r.id,
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        lastMileMs: r.lastMileMs,
      }
    : undefined;
}

/** An edge PoP (CDN, anycast DNS) close to the users of one region: same coordinates, no last mile. */
export function edgePlace(user: Place): Place {
  return {
    ...user,
    key: `edge:${user.id}`,
    kind: 'edge',
    name: `edge near ${user.name}`,
    lastMileMs: user.lastMileMs,
  };
}

type ProviderSource = Pick<ComponentSource, 'get'>;

/** Looks a cloud region up in the board's provider, then in the generic provider. */
export function findCloudRegion(
  registry: ProviderSource,
  providerId: ProviderId | undefined,
  regionId: string,
): Place | undefined {
  for (const pid of [providerId ?? 'generic', 'generic']) {
    const p = registry.get(pid, 'provider') as ProviderDefinition | undefined;
    const r = p?.regions.find((x) => x.id === regionId);
    if (r) return cloudPlace(r);
  }
  return undefined;
}

export function buildGeoModel(
  model: Model,
  graph: { groups: readonly { id: string; kind: string; regionId?: string | undefined }[] },
  scenario: Scenario,
  registry: ProviderSource,
  providerId: ProviderId | undefined,
): GeoModel {
  const issues: Finding[] = [];
  const nodePlace = new Map<string, Place>();
  const unknown = new Map<string, string[]>();
  for (const n of model.nodes.values()) {
    if (n.regionId === undefined) continue;
    const p = findCloudRegion(registry, providerId, n.regionId);
    if (p) nodePlace.set(n.id, p);
    else unknown.set(n.regionId, [...(unknown.get(n.regionId) ?? []), n.id]);
  }
  for (const [rid, ids] of unknown) {
    issues.push(
      engineFinding(
        'engine.compile',
        'warning',
        'Unknown region',
        `Region "${rid}" is not one of the provider's regions, so distance to it is ignored. Pick a region in the group's settings.`,
        ids,
      ),
    );
  }
  const unknownUsers = Object.keys(scenario.usersByRegion).filter((id) => !userRegion(id));
  if (unknownUsers.length > 0) {
    issues.push(
      engineFinding(
        'engine.route',
        'info',
        'Unknown user region',
        `User region(s) ${unknownUsers.map((u) => `"${u}"`).join(', ')} have no location: their network distance is counted as 0 ms and they are always at peak.`,
        [],
      ),
    );
  }

  const unhealthy = new Set<string>();
  const regionGroups = new Map(graph.groups.map((g) => [g.id, g]));
  for (const e of scenario.events) {
    if (e.kind === 'regionOutage') unhealthy.add(e.regionId);
    if (e.kind === 'groupOutage') {
      const g = regionGroups.get(e.groupId);
      if (g?.kind === 'region' && g.regionId !== undefined) unhealthy.add(g.regionId);
    }
  }

  const active = nodePlace.size > 0;
  if (!active && model.nodes.size > 0 && Object.keys(scenario.usersByRegion).length > 1) {
    issues.push(
      engineFinding(
        'engine.route',
        'info',
        'No regions placed',
        'Users are in several regions but no component is in a Region group with a region set, so network distance is not simulated (0 ms). Wrap your servers in a Region group and pick its region.',
        [],
      ),
    );
  }
  return { active, nodePlace, unhealthy, issues };
}
