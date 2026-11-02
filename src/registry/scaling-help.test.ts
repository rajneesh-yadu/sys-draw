/**
 * S23: every component says what the shared Scaling fields mean for it (`.meta(scalingHelp())`
 * on its configSchema), and the text matches how the simulation treats replicas.
 */
import { describe, expect, it } from 'vitest';
import type { ComponentDefinition } from '@/core';
import { registry } from './index';
import {
  ScalingHelpSchema,
  managedPerRequest,
  scalingHelp,
  type ScalingHelp,
} from './scaling-help';

const components = registry.list({ kind: 'component' }) as ComponentDefinition[];
const helpOf = (d: ComponentDefinition): ScalingHelp =>
  (d.configSchema.meta() as { scalingHelp: ScalingHelp }).scalingHelp;

/** Config keys tagged with a scaling role (`.meta({ scaling })`), looking through wrappers. */
function roles(d: ComponentDefinition): Set<string> {
  const out = new Set<string>();
  for (const field of Object.values(d.configSchema.shape)) {
    let cur = field as
      | { meta?: () => Record<string, unknown> | undefined; def?: { innerType?: unknown } }
      | undefined;
    for (let i = 0; cur && i < 8; i++) {
      const role = cur.meta?.()?.scaling;
      if (typeof role === 'string') out.add(role);
      cur = cur.def?.innerType as typeof cur;
    }
  }
  return out;
}

describe('component scaling help', () => {
  it('every component declares valid help for Replicas', () => {
    expect(components.length).toBeGreaterThan(30);
    for (const d of components) {
      const parsed = ScalingHelpSchema.safeParse(helpOf(d));
      expect(parsed.success, d.id).toBe(true);
    }
  });

  it('single-writer stores explain extra replicas as read replicas, not standbys or backups', () => {
    const singleWriter = components.filter(
      (d) => d.perf.scaleCurve === 'single-writer' && roles(d).has('readReplicas'),
    );
    expect(singleWriter.map((d) => d.id).sort()).toEqual([
      'cache.redis',
      'database.aurora',
      'database.mongodb',
      'database.postgres',
      'database.sql',
    ]);
    for (const d of singleWriter) {
      const h = helpOf(d);
      expect(h.replicas, d.id).toMatch(/^1 = /);
      expect(h.replicas, d.id).toMatch(/read/);
      expect(h.replicas, d.id).toMatch(/on top of/);
      expect(h.autoscale, d.id).toBeDefined();
    }
    // a separate standby knob exists, so the help must say replicas are not it
    for (const id of ['database.postgres', 'database.sql']) {
      expect(helpOf(registry.require(id, 'component')).replicas).toMatch(/not a failover standby/);
    }
  });

  it('platform-scaled functions say replicas and autoscale are ignored', () => {
    for (const d of components.filter((c) => roles(c).has('maxInstances'))) {
      expect(helpOf(d).replicas, d.id).toMatch(/^Ignored/);
      expect(helpOf(d).autoscale, d.id).toMatch(/^Ignored/);
    }
  });

  it('services billed per request say replicas do not change cost', () => {
    const perRequest = components.filter(
      (d) => d.category !== 'clients' && d.instanceTypes.every((t) => t.costUsdPerHour === 0),
    );
    expect(perRequest.length).toBeGreaterThan(5);
    for (const d of perRequest) expect(helpOf(d).replicas, d.id).toMatch(/per request/);
  });

  it('clients say replicas are not used', () => {
    expect(helpOf(registry.require('client.app', 'component')).replicas).toMatch(/^Not used/);
  });

  it('help stays short enough to read under the field', () => {
    for (const d of components) {
      for (const text of Object.values(helpOf(d)).filter((t) => t !== undefined)) {
        expect(text.length, d.id).toBeLessThanOrEqual(400);
        expect(text.split(/(?<=\.)\s/).length, d.id).toBeLessThanOrEqual(5);
      }
    }
  });

  it('helpers validate', () => {
    expect(() => scalingHelp({ replicas: '' })).toThrow();
    expect(managedPerRequest('queue', 'Extra.').replicas).toMatch(/queue.*per request.*Extra\.$/);
  });
});
