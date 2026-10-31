/**
 * Versioned migrations for the saved Workspace document.
 * To change a saved type: add `vN-to-vN+1.ts`, append it to MIGRATIONS, bump CURRENT_SCHEMA_VERSION,
 * update the schema, and add a migration test with a vN fixture.
 */
import type { Migration, RawDoc } from './types';
import { v0ToV1 } from './v0-to-v1';

export type { Migration, RawDoc } from './types';

/** Ordered, contiguous: MIGRATIONS[i] goes from version i to i + 1. */
export const MIGRATIONS: readonly Migration[] = [v0ToV1];

export const CURRENT_SCHEMA_VERSION = 1;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Throws if the chain is not 0→1→…→latest, one step each. */
export function assertMigrationChain(
  migrations: readonly Migration[] = MIGRATIONS,
  latest: number = CURRENT_SCHEMA_VERSION,
): void {
  if (migrations.length !== latest) {
    throw new MigrationError(
      `Expected ${latest} migrations to reach v${latest}, found ${migrations.length}`,
    );
  }
  migrations.forEach((m, i) => {
    if (m.from !== i || m.to !== i + 1) {
      throw new MigrationError(
        `Migration #${i} must go v${i}→v${i + 1} but goes v${m.from}→v${m.to}`,
      );
    }
  });
}

/** `schemaVersion` of a raw doc; a missing field means v0 (pre-versioned). */
export function getSchemaVersion(doc: unknown): number {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new MigrationError('Saved document must be a JSON object');
  }
  const v = (doc as RawDoc).schemaVersion;
  if (v === undefined) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new MigrationError(
      `schemaVersion must be a non-negative integer, got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

export interface MigrateResult {
  doc: RawDoc;
  fromVersion: number;
  toVersion: number;
  /** Descriptions of the migrations that ran, in order. */
  applied: string[];
}

/**
 * Bring a raw saved document up to `target` (default: latest). Pure: the input is never mutated.
 * Does not validate the result; use `loadWorkspace` for migrate + validate.
 */
export function migrate(
  doc: unknown,
  options: { migrations?: readonly Migration[]; target?: number } = {},
): MigrateResult {
  const migrations = options.migrations ?? MIGRATIONS;
  const target = options.target ?? migrations.length;
  const fromVersion = getSchemaVersion(doc);
  if (fromVersion > target) {
    throw new MigrationError(
      `This file was saved by a newer SysDraw (schema v${fromVersion}); this version reads up to v${target}`,
    );
  }
  let current = structuredClone(doc) as RawDoc;
  const applied: string[] = [];
  for (let v = fromVersion; v < target; v++) {
    const step = migrations[v];
    if (step?.from !== v || step.to !== v + 1) {
      throw new MigrationError(`No migration from v${v} to v${v + 1}`);
    }
    current = step.up(current);
    if (current.schemaVersion !== step.to) {
      throw new MigrationError(
        `Migration v${step.from}→v${step.to} did not set schemaVersion to ${step.to}`,
      );
    }
    applied.push(`v${step.from}→v${step.to}: ${step.description}`);
  }
  return { doc: current, fromVersion, toVersion: target, applied };
}
