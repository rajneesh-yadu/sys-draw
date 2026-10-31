/**
 * Extension contract (ARCHITECTURE.md): one `define*` helper per entry kind. Each validates with Zod
 * when the file is imported, throws a readable error naming the entry, and returns a frozen entry
 * that auto-discovery recognises.
 */
import { z } from 'zod';
import { ComponentDefinitionSchema, ProtocolDefinitionSchema, safeParseReadable } from '@/core';
import {
  LessonDefinitionSchema,
  ProviderDefinitionSchema,
  RegistryProblemSchema,
  RuleDefinitionSchema,
} from './schemas';

export const REGISTRY_KINDS = [
  'component',
  'protocol',
  'provider',
  'problem',
  'rule',
  'lesson',
] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

const SCHEMAS = {
  component: ComponentDefinitionSchema,
  protocol: ProtocolDefinitionSchema,
  provider: ProviderDefinitionSchema,
  problem: RegistryProblemSchema,
  rule: RuleDefinitionSchema,
  lesson: LessonDefinitionSchema,
} as const;

/** Output type of each kind's entries. */
export type EntryByKind = { [K in RegistryKind]: z.output<(typeof SCHEMAS)[K]> };
/** What a registry file passes to its define* helper. */
export type EntryInputByKind = { [K in RegistryKind]: z.input<(typeof SCHEMAS)[K]> };
export type AnyRegistryEntry = EntryByKind[RegistryKind];

/** Entries created by a define* helper, with their kind. Discovery only collects these. */
const ENTRY_KINDS = new WeakMap<object, RegistryKind>();

export function registryKindOf(value: unknown): RegistryKind | undefined {
  return typeof value === 'object' && value !== null ? ENTRY_KINDS.get(value) : undefined;
}

export class RegistryEntryError extends Error {
  readonly kind: RegistryKind;
  readonly entryId: string;
  readonly errors: string[];
  constructor(kind: RegistryKind, entryId: string, errors: string[]) {
    super(`Invalid ${kind} "${entryId}":\n  - ${errors.join('\n  - ')}`);
    this.name = 'RegistryEntryError';
    this.kind = kind;
    this.entryId = entryId;
    this.errors = errors;
  }
}

/** Freeze plain data deeply; Zod schemas and functions are left alone (Zod caches on its instances). */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (value instanceof z.ZodType || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

function define<K extends RegistryKind>(kind: K, input: EntryInputByKind[K]): EntryByKind[K] {
  const res = safeParseReadable(SCHEMAS[kind], input);
  if (!res.ok) {
    const id = (input as { id?: unknown } | null)?.id;
    throw new RegistryEntryError(kind, typeof id === 'string' ? id : '(no id)', res.errors);
  }
  const entry = deepFreeze(res.value) as EntryByKind[K];
  ENTRY_KINDS.set(entry, kind);
  return entry;
}

export const defineComponent = (input: EntryInputByKind['component']) => define('component', input);
export const defineProtocol = (input: EntryInputByKind['protocol']) => define('protocol', input);
export const defineProvider = (input: EntryInputByKind['provider']) => define('provider', input);
export const defineProblem = (input: EntryInputByKind['problem']) => define('problem', input);
export const defineRule = (input: EntryInputByKind['rule']) => define('rule', input);
export const defineLesson = (input: EntryInputByKind['lesson']) => define('lesson', input);
