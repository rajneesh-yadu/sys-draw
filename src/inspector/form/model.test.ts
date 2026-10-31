import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registry } from '@/registry';
import { buildFormModel, defaultValueFor, humanize, inferUnit, type FieldModel } from './model';
import { errorAt, issuesByPath, setAtPath } from './validate';

const Schema = z.object({
  timeoutMs: z.number().int().min(10).max(5000).describe('Give up after'),
  ratio: z.number().min(0).max(1).optional(),
  mode: z.enum(['a', 'b']),
  enabled: z.boolean(),
  name: z.string().trim().min(1),
  nested: z.object({ sizeBytes: z.number().nonnegative(), flag: z.boolean() }),
  tags: z.array(z.object({ key: z.string(), weight: z.number().int().positive() })),
  users: z.record(z.string(), z.number().nonnegative()),
  secret: z.string().meta({ advanced: true, label: 'API secret' }),
  hidden: z.number().meta({ hidden: true }),
  weird: z.union([z.string(), z.number()]),
});

const byKey = (fields: FieldModel[], key: string) => fields.find((f) => f.key === key)!;

describe('buildFormModel', () => {
  const { basic, advanced } = buildFormModel(Schema);

  it('describes numbers with unit, bounds, int and help', () => {
    expect(byKey(basic, 'timeoutMs')).toMatchObject({
      kind: 'number',
      label: 'Timeout',
      unit: 'ms',
      min: 10,
      max: 5000,
      int: true,
      help: 'Give up after',
      optional: false,
      advanced: false,
      path: ['timeoutMs'],
    });
    expect(byKey(basic, 'ratio')).toMatchObject({
      kind: 'number',
      min: 0,
      max: 1,
      int: false,
      optional: true,
    });
  });

  it('describes enum, boolean, string, nested object, array and record', () => {
    expect(byKey(basic, 'mode')).toMatchObject({
      kind: 'enum',
      options: [
        { value: 'a', label: 'a' },
        { value: 'b', label: 'b' },
      ],
    });
    expect(byKey(basic, 'enabled').kind).toBe('boolean');
    expect(byKey(basic, 'name')).toMatchObject({ kind: 'string', minLength: 1 });
    const nested = byKey(basic, 'nested');
    expect(
      nested.kind === 'object' && nested.fields.map((f) => [f.key, f.kind, f.path.join('.')]),
    ).toEqual([
      ['sizeBytes', 'number', 'nested.sizeBytes'],
      ['flag', 'boolean', 'nested.flag'],
    ]);
    expect(nested.kind === 'object' && nested.fields[0]).toMatchObject({
      unit: 'bytes',
      label: 'Size',
    });
    const tags = byKey(basic, 'tags');
    expect(tags.kind === 'array' && tags.item.kind).toBe('object');
    expect(tags.kind === 'array' && tags.item.path).toEqual(['tags', 0]);
    const users = byKey(basic, 'users');
    expect(users.kind === 'record' && users.value.kind).toBe('number');
    expect(byKey(basic, 'weird')).toMatchObject({ kind: 'unsupported', typeName: 'union' });
  });

  it('splits Basic / Advanced by meta and drops hidden fields', () => {
    expect(advanced.map((f) => [f.key, f.label])).toEqual([['secret', 'API secret']]);
    expect(basic.some((f) => f.key === 'hidden' || f.key === 'secret')).toBe(false);
  });

  it('applies overrides by exact and wildcard path', () => {
    const m = buildFormModel(Schema, {
      mode: { options: [{ value: 'a', label: 'Alpha' }] },
      'tags.*.weight': { label: 'Weight', unit: 'pts' },
      timeoutMs: { advanced: true },
    });
    expect(byKey(m.basic, 'mode')).toMatchObject({ options: [{ value: 'a', label: 'Alpha' }] });
    const tags = byKey(m.basic, 'tags');
    const item = tags.kind === 'array' ? tags.item : undefined;
    expect(item?.kind === 'object' && item.fields[1]).toMatchObject({
      label: 'Weight',
      unit: 'pts',
    });
    expect(m.advanced.map((f) => f.key)).toContain('timeoutMs');
  });

  it('reads every registry component config schema with no unsupported fields', () => {
    for (const def of registry.list({ kind: 'component' })) {
      const { basic: b, advanced: a } = buildFormModel(def.configSchema);
      expect(
        [...b, ...a].filter((f) => f.kind === 'unsupported'),
        def.id,
      ).toEqual([]);
      expect(b.length + a.length).toBe(Object.keys(def.configSchema.shape).length);
    }
    const app = buildFormModel(registry.require('compute.app-server', 'component').configSchema);
    expect(app.advanced.map((f) => f.key)).toEqual([
      'workerThreads',
      'requestTimeoutMs',
      'dbPoolSize',
      'gcPauseMs',
    ]);
  });
});

describe('helpers', () => {
  it('infers units and labels from key names', () => {
    expect(inferUnit('ttlSec')).toBe('s');
    expect(inferUnit('storageGb')).toBe('GB');
    expect(inferUnit('costUsdPerMonth')).toBe('$/mo');
    expect(inferUnit('replicas')).toBeUndefined();
    expect(humanize('requestTimeoutMs')).toBe('Request timeout');
    expect(humanize('usersByRegion')).toBe('Users by region');
    expect(humanize('Ms')).toBe('Ms');
  });

  it('builds default values that satisfy the schema where possible', () => {
    const { basic } = buildFormModel(Schema);
    expect(defaultValueFor(byKey(basic, 'timeoutMs'))).toBe(10);
    expect(defaultValueFor(byKey(basic, 'mode'))).toBe('a');
    expect(defaultValueFor(byKey(basic, 'nested'))).toEqual({ sizeBytes: 1, flag: false });
    const tags = byKey(basic, 'tags');
    expect(tags.kind === 'array' && defaultValueFor(tags.item)).toEqual({ key: '', weight: 1 });
  });

  it('maps issues to readable reasons by path', () => {
    const S = z.object({
      n: z.number().int().min(1).max(10),
      p: z.number().positive(),
      s: z.string().trim().min(1),
      e: z.enum(['x', 'y']),
      o: z
        .object({ a: z.number() })
        .refine((v) => v.a < 5, { message: 'a must be < 5', path: ['a'] }),
    });
    const errs = issuesByPath(S, { n: 0, p: 0, s: ' ', e: 'z', o: { a: 9 } });
    expect(errs).toEqual({
      n: 'Must be ≥ 1',
      p: 'Must be > 0',
      s: 'Must not be empty',
      e: 'Choose one of: x, y',
      'o.a': 'a must be < 5',
    });
    expect(issuesByPath(S, { n: 11, p: 1, s: 'x', e: 'x', o: { a: 1 } })).toEqual({
      n: 'Must be ≤ 10',
    });
    expect(issuesByPath(S, { n: 1.5, p: 1, s: 'x', e: 'x', o: { a: 1 } }).n).toMatch(
      /whole number|integer/i,
    );
    expect(errorAt(errs, ['o'])).toBe('a must be < 5');
    expect(errorAt({}, ['o'])).toBeNull();
  });

  it('sets values immutably by path and deletes on undefined', () => {
    const root = { a: { b: 1, c: 2 }, l: [1, 2] };
    expect(setAtPath(root, ['a', 'b'], 5)).toEqual({ a: { b: 5, c: 2 }, l: [1, 2] });
    expect(setAtPath(root, ['l', 1], 9)).toEqual({ a: { b: 1, c: 2 }, l: [1, 9] });
    expect(setAtPath(root, ['a', 'c'], undefined)).toEqual({ a: { b: 1 }, l: [1, 2] });
    expect(root).toEqual({ a: { b: 1, c: 2 }, l: [1, 2] });
  });
});
