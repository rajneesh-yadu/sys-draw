/**
 * Prefixed ids for saved entities and dotted ids for registry entries.
 * Conventions (ARCHITECTURE.md): `node_`, `edge_`, `grp_`, `board_`; registry ids are dotted
 * (`cache.redis`, `proto.http2`, `problem.rate-limiter`).
 */
import { z } from 'zod';

export const ID_PREFIXES = {
  project: 'proj_',
  board: 'board_',
  node: 'node_',
  edge: 'edge_',
  group: 'grp_',
  snapshot: 'snap_',
  flow: 'flow_',
  event: 'evt_',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** Body after the prefix: letters, digits, `-` and `_`, 1–64 chars. */
const ID_BODY = '[A-Za-z0-9_-]{1,64}';
const ID_PATTERNS: Record<IdKind, RegExp> = Object.fromEntries(
  Object.entries(ID_PREFIXES).map(([kind, prefix]) => [kind, new RegExp(`^${prefix}${ID_BODY}$`)]),
) as Record<IdKind, RegExp>;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Default random body: 12 base-36 chars from crypto.getRandomValues (~62 bits). */
export function randomIdBody(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Create a new prefixed id, e.g. `newId('node')` → `node_k3f9x0a2b7qz`.
 * Pass `body` to make ids deterministic (tests, fixtures, seeded generators).
 */
export function newId(kind: IdKind, body: string = randomIdBody()): string {
  const id = `${ID_PREFIXES[kind]}${body}`;
  if (!ID_PATTERNS[kind].test(id)) {
    throw new Error(`Invalid ${kind} id body "${body}": use 1–64 letters, digits, "-" or "_"`);
  }
  return id;
}

/** True when `value` is a well-formed id of the given kind. */
export function isId(kind: IdKind, value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERNS[kind].test(value);
}

/** The kind of a prefixed id, or undefined if it matches none. */
export function idKindOf(value: string): IdKind | undefined {
  return (Object.keys(ID_PATTERNS) as IdKind[]).find((k) => ID_PATTERNS[k].test(value));
}

/** Zod schema for an id of one kind, with a readable error. */
export function idSchema(kind: IdKind) {
  return z
    .string()
    .regex(ID_PATTERNS[kind], `Expected a ${kind} id like "${ID_PREFIXES[kind]}abc123"`);
}

/** Registry ids: lowercase dotted/dashed segments, e.g. `cache.redis`, `problem.rate-limiter`, `http2`. */
export const REGISTRY_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export function isRegistryId(value: unknown): value is string {
  return typeof value === 'string' && REGISTRY_ID_PATTERN.test(value);
}

export const RegistryIdSchema = z
  .string()
  .regex(
    REGISTRY_ID_PATTERN,
    'Expected a registry id: lowercase segments joined by "." or "-", e.g. "cache.redis"',
  );
