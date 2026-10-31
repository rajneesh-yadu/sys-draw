import { describe, expect, it } from 'vitest';
import { sampleWorkspace, sampleWorkspaceV0 } from '../fixtures/sample-workspace';
import { loadWorkspace } from '../load';
import {
  assertMigrationChain,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  migrate,
  MigrationError,
  MIGRATIONS,
  type Migration,
} from './index';

describe('migration chain', () => {
  it('is contiguous from v0 to latest', () => {
    expect(() => assertMigrationChain()).not.toThrow();
    expect(MIGRATIONS.at(-1)?.to).toBe(CURRENT_SCHEMA_VERSION);
  });
  it('detects gaps', () => {
    const bad: Migration[] = [{ from: 0, to: 2, description: 'skip', up: (d) => d }];
    expect(() => assertMigrationChain(bad, 1)).toThrow(/must go v0→v1/);
  });
});

describe('getSchemaVersion', () => {
  it('treats a missing version as v0 and rejects junk', () => {
    expect(getSchemaVersion({})).toBe(0);
    expect(getSchemaVersion({ schemaVersion: 1 })).toBe(1);
    expect(() => getSchemaVersion({ schemaVersion: '1' })).toThrow(MigrationError);
    expect(() => getSchemaVersion([])).toThrow(/JSON object/);
    expect(() => getSchemaVersion(null)).toThrow(MigrationError);
  });
});

describe('migrate v0 → v1', () => {
  it('upgrades the v0 sample to exactly the v1 sample', () => {
    const res = migrate(sampleWorkspaceV0);
    expect(res.fromVersion).toBe(0);
    expect(res.toVersion).toBe(1);
    expect(res.applied).toEqual(['v0→v1: Add schemaVersion and default user settings']);
    expect(res.doc).toEqual(sampleWorkspace);
  });
  it('keeps partial v0 settings and fills the rest', () => {
    const res = migrate({ projects: [], settings: { theme: 'dark' } });
    expect(res.doc.settings).toEqual({
      theme: 'dark',
      defaultProviderId: 'generic',
      autosave: true,
      showFormulas: true,
    });
  });
  it('does not mutate its input', () => {
    const input = structuredClone(sampleWorkspaceV0);
    migrate(input);
    expect(input).toEqual(sampleWorkspaceV0);
  });
  it('is a no-op for a current doc', () => {
    const res = migrate(sampleWorkspace);
    expect(res.applied).toEqual([]);
    expect(res.doc).toEqual(sampleWorkspace);
  });
  it('refuses docs from a newer version', () => {
    expect(() => migrate({ ...sampleWorkspace, schemaVersion: 99 })).toThrow(
      /newer SysDraw \(schema v99\)/,
    );
  });
  it('runs a multi-step chain in order', () => {
    const chain: Migration[] = [
      { from: 0, to: 1, description: 'a', up: (d) => ({ ...d, log: ['a'], schemaVersion: 1 }) },
      {
        from: 1,
        to: 2,
        description: 'b',
        up: (d) => ({ ...d, log: [...(d.log as string[]), 'b'], schemaVersion: 2 }),
      },
    ];
    const res = migrate({}, { migrations: chain });
    expect(res.doc).toEqual({ log: ['a', 'b'], schemaVersion: 2 });
  });
  it('catches a migration that forgets to bump schemaVersion', () => {
    const chain: Migration[] = [{ from: 0, to: 1, description: 'oops', up: (d) => d }];
    expect(() => migrate({}, { migrations: chain })).toThrow(/did not set schemaVersion to 1/);
  });
});

describe('loadWorkspace', () => {
  it('migrates and validates a v0 doc', () => {
    const res = loadWorkspace(JSON.parse(JSON.stringify(sampleWorkspaceV0)));
    expect(res).toMatchObject({ ok: true, value: sampleWorkspace, fromVersion: 0 });
  });
  it('returns readable errors instead of throwing', () => {
    expect(loadWorkspace({ schemaVersion: 7 })).toEqual({
      ok: false,
      errors: [
        '(root): This file was saved by a newer SysDraw (schema v7); this version reads up to v1',
      ],
    });
    const res = loadWorkspace({ projects: [{ id: 'p1' }] });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.errors).toContain('projects[0].id: Expected a project id like "proj_abc123"');
  });
});
