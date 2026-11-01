/**
 * Provider lookups (S12): availability, icons, instance/request/storage prices, service limits,
 * region mapping and the plan for switching a board's provider. Pure functions over registry data.
 */
import type { ComponentDefinition, Graph, ProviderId, Scenario } from '@/core';
import type { Registry } from './catalog';
import type { ProviderDefinition, ProviderService, ServiceLimit } from './schemas';

/** Components tagged with this exist on one cloud only (Spanner, Aurora) and never on generic. */
export const PROVIDER_ONLY_TAG = 'provider-only';

export function isProviderOnly(def: ComponentDefinition): boolean {
  return def.tags.includes(PROVIDER_ONLY_TAG);
}

/**
 * A component is available on `generic` always (unless provider-only); on a cloud provider when it
 * names a product there (`providerNames[provider]`) or declares no `providerNames` at all
 * (provider-neutral, e.g. clients).
 */
export function isAvailableOn(def: ComponentDefinition, provider: ProviderId): boolean {
  if (isProviderOnly(def)) return def.providerNames?.[provider] !== undefined;
  return (
    provider === 'generic' ||
    def.providerNames === undefined ||
    def.providerNames[provider] !== undefined
  );
}

/** Name to show for a component on a board: the provider's product name if any, else the generic name. */
export function componentDisplayName(def: ComponentDefinition, provider: ProviderId): string {
  return def.providerNames?.[provider] ?? def.name;
}

/** The provider's data for a component, if it has any. */
export function providerService(
  provider: ProviderDefinition | undefined,
  componentId: string,
): ProviderService | undefined {
  return provider?.services[componentId];
}

/** Icon for a component on a board of this provider (provider icon, else the component's). */
export function componentIcon(
  def: ComponentDefinition,
  provider: ProviderDefinition | undefined,
): string {
  return providerService(provider, def.id)?.icon ?? def.icon;
}

export interface InstancePrice {
  /** Provider name of the instance, e.g. 'db.m7i.large'. */
  name: string;
  costUsdPerHour: number;
  /** Where the price came from, for formulas: 'AWS price table (as of 2026-10-01)'. */
  source: string;
}

/**
 * The provider's price for a component's instance type, or undefined when the component's own
 * price × `pricing.instancePriceMultiplier` applies (generic provider, or no mapping).
 * Order: service `instancePrices[typeId]`, then the family size with `size === typeId` × the
 * service's `instancePriceMultiplier` (named with its `instanceNamePrefix`).
 */
export function instancePrice(
  provider: ProviderDefinition | undefined,
  componentId: string,
  typeId: string,
): InstancePrice | undefined {
  if (!provider) return undefined;
  const source = `${provider.shortName} price table, ${provider.pricing.region}, as of ${provider.pricing.asOf}`;
  const svc = provider.services[componentId];
  const own = svc?.instancePrices?.[typeId];
  if (own) return { name: own.name, costUsdPerHour: own.costUsdPerHour, source };
  for (const fam of provider.instanceFamilies) {
    const sz = fam.sizes.find((x) => x.size === typeId);
    if (!sz) continue;
    const mult = svc?.instancePriceMultiplier ?? 1;
    return {
      name: `${svc?.instanceNamePrefix ?? ''}${sz.name}`,
      costUsdPerHour: sz.costUsdPerHour * mult,
      source:
        mult === 1
          ? source
          : `${source}; managed premium ×${mult} over ${sz.name} $${sz.costUsdPerHour}/h`,
    };
  }
  return undefined;
}

/** Request and storage prices for a component on this provider (service overrides first). */
export function servicePricing(
  provider: ProviderDefinition | undefined,
  componentId: string,
): { requestsUsdPerMillion?: number; storageUsdPerGbMonth?: number } {
  const svc = providerService(provider, componentId);
  return {
    ...(svc?.requestsUsdPerMillion !== undefined
      ? { requestsUsdPerMillion: svc.requestsUsdPerMillion }
      : {}),
    ...(svc?.storageUsdPerGbMonth !== undefined
      ? { storageUsdPerGbMonth: svc.storageUsdPerGbMonth }
      : {}),
  };
}

/** Limits of a component on this provider that apply to this config (`when` matched). */
export function serviceLimits(
  provider: ProviderDefinition | undefined,
  componentId: string,
  config?: Readonly<Record<string, unknown>>,
): ServiceLimit[] {
  const limits = providerService(provider, componentId)?.limits ?? [];
  return limits.filter(
    (l) => !l.when || config === undefined || config[l.when.field] === l.when.equals,
  );
}

/** Generic region id of a provider region (the generic provider's ids are their own). */
function genericRegionOf(provider: ProviderDefinition, regionId: string): string | undefined {
  if (provider.id === 'generic')
    return provider.regions.some((r) => r.id === regionId) ? regionId : undefined;
  return provider.regions.find((r) => r.id === regionId)?.genericId;
}

export interface RegionMapping {
  id: string;
  /** False when the target has no region in that metro and the nearest one was picked. */
  exact: boolean;
  /** Great-circle distance from the source region (km), when not exact. */
  distanceKm?: number;
}

const EARTH_RADIUS_KM = 6371;
function greatCircleKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The same metro's region on another provider: from → generic id → to (via `genericId`). A region
 * the source provider does not know (e.g. a generic id kept on an AWS board) is tried as a generic
 * id. When the target has no region in that metro, the nearest one by great-circle distance
 * (`exact: false`). Undefined only when the source region's location is unknown.
 */
export function mapRegion(
  from: ProviderDefinition | undefined,
  to: ProviderDefinition,
  regionId: string,
  generic?: ProviderDefinition,
): RegionMapping | undefined {
  if (from?.id === to.id && to.regions.some((r) => r.id === regionId))
    return { id: regionId, exact: true };
  const g = (from && genericRegionOf(from, regionId)) ?? regionId;
  const exact =
    to.id === 'generic'
      ? to.regions.find((r) => r.id === g)
      : to.regions.find((r) => r.genericId === g);
  if (exact) return { id: exact.id, exact: true };
  const src =
    from?.regions.find((r) => r.id === regionId) ??
    generic?.regions.find((r) => r.id === g) ??
    undefined;
  if (!src) return undefined;
  let best: { id: string; km: number } | undefined;
  for (const r of to.regions) {
    const km = greatCircleKm(src, r);
    if (!best || km < best.km) best = { id: r.id, km };
  }
  return best ? { id: best.id, exact: false, distanceKm: Math.round(best.km) } : undefined;
}

/** `mapRegion(...)?.id`, looking up the generic provider in `registry` for locations. */
export function mapRegionId(
  from: ProviderDefinition | undefined,
  to: ProviderDefinition,
  regionId: string,
  generic?: ProviderDefinition,
): string | undefined {
  return mapRegion(from, to, regionId, generic)?.id;
}

export interface SwitchRelabel {
  nodeId: string;
  label: string;
  from: string;
  to: string;
  iconFrom: string;
  iconTo: string;
}
export interface SwitchWarning {
  /** Node or group id (or 'scenario' for chaos events). */
  targetId: string;
  label: string;
  message: string;
}
export interface SwitchRegion {
  targetId: string;
  label: string;
  from: string;
  /** Undefined when the region's location is unknown. */
  to: string | undefined;
  /** True when the target has no region in that metro and the nearest one was picked. */
  nearest?: boolean;
}
export interface ProviderSwitchPlan {
  from: ProviderId;
  to: ProviderId;
  relabels: SwitchRelabel[];
  /** Nodes whose component has no product on the target provider. */
  noEquivalent: SwitchWarning[];
  regions: SwitchRegion[];
  /** Nodes that gain or lose provider limits, e.g. "Lambda: concurrent executions ≤ 1000". */
  limits: { nodeId: string; label: string; limits: string[] }[];
}

const providerLabel = (registry: Pick<Registry, 'get'>, id: ProviderId) =>
  registry.get(id, 'provider')?.shortName ?? id;

/**
 * What switching a board from one provider to another does, without doing it (the store's
 * `setProvider` command applies the region part; names, icons, prices and limits follow from
 * `providerId`). Used for the confirmation in the provider picker.
 */
export function planProviderSwitch(
  registry: Pick<Registry, 'get'>,
  graph: Graph,
  scenario: Scenario | undefined,
  from: ProviderId,
  to: ProviderId,
): ProviderSwitchPlan {
  const fromP = registry.get(from, 'provider');
  const toP = registry.get(to, 'provider');
  const plan: ProviderSwitchPlan = {
    from,
    to,
    relabels: [],
    noEquivalent: [],
    regions: [],
    limits: [],
  };
  const toName = providerLabel(registry, to);

  for (const n of graph.nodes) {
    const def = registry.get(n.defId, 'component');
    if (!def) continue;
    const a = componentDisplayName(def, from);
    const b = componentDisplayName(def, to);
    const ia = componentIcon(def, fromP);
    const ib = componentIcon(def, toP);
    if (a !== b || ia !== ib)
      plan.relabels.push({
        nodeId: n.id,
        label: n.label,
        from: a,
        to: b,
        iconFrom: ia,
        iconTo: ib,
      });
    if (!isAvailableOn(def, to)) {
      const owner = (['aws', 'gcp', 'azure'] as const).find((p) => def.providerNames?.[p]);
      const nearestId = owner
        ? registry.get(owner, 'provider')?.services[def.id]?.nearest
        : undefined;
      const nearest = nearestId ? registry.get(nearestId, 'component') : undefined;
      plan.noEquivalent.push({
        targetId: n.id,
        label: n.label,
        message:
          `${a} has no ${toName} equivalent; it keeps simulating with its own model.` +
          (nearest
            ? ` Nearest building block on ${toName}: ${componentDisplayName(nearest, to)} (${nearest.name}).`
            : ''),
      });
    }
    if (toP) {
      const la = toP.id === fromP?.id ? [] : serviceLimits(toP, def.id, n.config);
      if (la.length > 0)
        plan.limits.push({
          nodeId: n.id,
          label: n.label,
          limits: la.map((l) => `${l.label}: ${l.value.toLocaleString('en-US')} ${l.unit}`),
        });
    }
  }

  if (toP) {
    const seen = new Set<string>();
    const genericP = registry.get('generic', 'provider');
    const add = (targetId: string, label: string, regionId: string) => {
      const mapped = mapRegion(fromP, toP, regionId, genericP);
      if (mapped?.id === regionId) return;
      const key = `${targetId}:${regionId}`;
      if (seen.has(key)) return;
      seen.add(key);
      plan.regions.push({
        targetId,
        label,
        from: regionId,
        to: mapped?.id,
        ...(mapped && !mapped.exact ? { nearest: true } : {}),
      });
    };
    for (const g of graph.groups) if (g.regionId !== undefined) add(g.id, g.label, g.regionId);
    for (const e of scenario?.events ?? []) {
      if (e.kind === 'regionOutage') add('scenario', 'Region outage event', e.regionId);
      if (e.kind === 'networkPartition') {
        add('scenario', 'Network partition event', e.regionA);
        add('scenario', 'Network partition event', e.regionB);
      }
    }
  }
  return plan;
}
