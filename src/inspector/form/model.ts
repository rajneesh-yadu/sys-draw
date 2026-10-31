/**
 * Zod schema → form model. Pure (no React): walks a Zod object schema and describes each field
 * (kind, label, unit, bounds, help, advanced) so widgets can render it. Labels and help come from
 * `.describe()` / `.meta()` on the schema; panels may add `FieldOverrides` for schemas they don't
 * own (e.g. core's scaling schema) without touching those schemas.
 */
import type { z } from 'zod';

/** Field meta read from `.meta({...})` on a registry schema, or passed as an override. */
export interface FieldMeta {
  label?: string;
  help?: string;
  /** Shown in the collapsed Advanced section. */
  advanced?: boolean;
  /** Display unit, e.g. 'ms'. Inferred from the key suffix (`timeoutMs`) when omitted. */
  unit?: string;
  /** Turns a string field into a select with these choices (e.g. instance types). */
  options?: readonly { value: string; label: string }[];
  /** Value used when an optional field is switched on or an array item is added. */
  defaultValue?: unknown;
  /** Leave the field out of the form. */
  hidden?: boolean;
  /** Input step for numbers (defaults to 1 for integers, "any" otherwise). */
  step?: number;
}

/** Overrides keyed by dotted path ('autoscale.min', 'firewallRules.*.peer' for array items). */
export type FieldOverrides = Readonly<Record<string, FieldMeta>>;

interface FieldBase {
  key: string;
  /** Path from the form root; array items use their index. */
  path: (string | number)[];
  label: string;
  help?: string;
  advanced: boolean;
  /** Wrapped in `.optional()`: can be cleared / switched off. */
  optional: boolean;
  defaultValue?: unknown;
}

export type FieldModel =
  | (FieldBase & {
      kind: 'number';
      unit?: string;
      min?: number;
      max?: number;
      int: boolean;
      step?: number;
    })
  | (FieldBase & { kind: 'enum'; options: { value: string; label: string }[] })
  | (FieldBase & { kind: 'boolean' })
  | (FieldBase & { kind: 'string'; minLength?: number; maxLength?: number })
  | (FieldBase & { kind: 'object'; fields: FieldModel[] })
  | (FieldBase & { kind: 'array'; item: FieldModel })
  | (FieldBase & { kind: 'record'; value: FieldModel })
  | (FieldBase & { kind: 'unsupported'; typeName: string });

export type FieldKind = FieldModel['kind'];

// ---------- Introspection helpers (Zod 4) ----------

type AnySchema = z.ZodType;

const typeOf = (s: AnySchema): string => (s as unknown as { def: { type: string } }).def.type;

function metaOf(s: AnySchema): FieldMeta {
  const m = (s as unknown as { meta(): Record<string, unknown> | undefined }).meta() ?? {};
  const out: FieldMeta = { ...(m as FieldMeta) };
  const description = (m.description ?? s.description) as string | undefined;
  if (description !== undefined && out.help === undefined) out.help = description;
  return out;
}

/** Peel optional/default/nullable/readonly wrappers; collect meta from every layer (outer wins). */
function unwrap(schema: AnySchema): { inner: AnySchema; optional: boolean; meta: FieldMeta } {
  let cur = schema;
  let optional = false;
  const layers: FieldMeta[] = [];
  for (;;) {
    layers.push(metaOf(cur));
    const t = typeOf(cur);
    if (t === 'optional' || t === 'default' || t === 'nullable' || t === 'readonly') {
      if (t === 'optional' || t === 'nullable') optional = true;
      cur = (cur as unknown as { def: { innerType: AnySchema } }).def.innerType;
      continue;
    }
    break;
  }
  const meta = Object.assign({}, ...layers.reverse()) as FieldMeta;
  return { inner: cur, optional, meta };
}

const UNIT_SUFFIXES: [RegExp, string][] = [
  [/UsdPerMonth$/, '$/mo'],
  [/UsdPerHour$/, '$/h'],
  [/Usd$/, '$'],
  [/Ms$/, 'ms'],
  [/Sec$/, 's'],
  [/Bytes$/, 'bytes'],
  [/Gb$/, 'GB'],
  [/Mb$/, 'MB'],
  [/Kb$/, 'KB'],
  [/Pct$/, '%'],
  [/Rps$/, 'rps'],
  [/Gbps$/, 'Gbps'],
];

/** Unit from the naming convention (`latencyMs` → 'ms', `storageGb` → 'GB'), or undefined. */
export function inferUnit(key: string): string | undefined {
  for (const [re, unit] of UNIT_SUFFIXES) if (re.test(key)) return unit;
  return undefined;
}

/** 'requestTimeoutMs' → 'Request timeout', 'usersByRegion' → 'Users by region'. */
export function humanize(key: string): string {
  let base = key;
  for (const [re] of UNIT_SUFFIXES) {
    if (re.test(base) && base.replace(re, '') !== '') {
      base = base.replace(re, '');
      break;
    }
  }
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const finiteBound = (n: unknown): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER
    ? n
    : undefined;

function overrideFor(overrides: FieldOverrides, path: (string | number)[]): FieldMeta {
  const exact = path.join('.');
  const wildcard = path.map((p) => (typeof p === 'number' ? '*' : p)).join('.');
  return { ...overrides[wildcard], ...overrides[exact] };
}

// ---------- Model builder ----------

/** Describe one schema at `path`. */
export function buildField(
  schema: AnySchema,
  key: string,
  path: (string | number)[],
  overrides: FieldOverrides = {},
): FieldModel {
  const { inner, optional, meta: schemaMeta } = unwrap(schema);
  const meta: FieldMeta = { ...schemaMeta, ...overrideFor(overrides, path) };
  const base: FieldBase = {
    key,
    path,
    label: meta.label ?? humanize(key),
    advanced: meta.advanced === true,
    optional,
    ...(meta.help !== undefined ? { help: meta.help } : {}),
    ...(meta.defaultValue !== undefined ? { defaultValue: meta.defaultValue } : {}),
  };
  const t = typeOf(inner);

  if (meta.options !== undefined && (t === 'string' || t === 'enum')) {
    return { ...base, kind: 'enum', options: [...meta.options] };
  }
  switch (t) {
    case 'number': {
      const n = inner as unknown as { minValue: unknown; maxValue: unknown; isInt: boolean };
      const min = finiteBound(n.minValue);
      const max = finiteBound(n.maxValue);
      const unit = meta.unit ?? inferUnit(key);
      return {
        ...base,
        kind: 'number',
        int: n.isInt === true,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(meta.step !== undefined ? { step: meta.step } : {}),
      };
    }
    case 'enum': {
      const values = (inner as unknown as { options: (string | number)[] }).options.map(String);
      return { ...base, kind: 'enum', options: values.map((v) => ({ value: v, label: v })) };
    }
    case 'boolean':
      return { ...base, kind: 'boolean' };
    case 'string': {
      const s = inner as unknown as { minLength: number | null; maxLength: number | null };
      return {
        ...base,
        kind: 'string',
        ...(typeof s.minLength === 'number' ? { minLength: s.minLength } : {}),
        ...(typeof s.maxLength === 'number' ? { maxLength: s.maxLength } : {}),
      };
    }
    case 'object':
      return {
        ...base,
        kind: 'object',
        fields: buildFields(inner as unknown as z.ZodObject, overrides, path),
      };
    case 'array': {
      const element = (inner as unknown as { element: AnySchema }).element;
      return { ...base, kind: 'array', item: buildField(element, key, [...path, 0], overrides) };
    }
    case 'record': {
      const valueType = (inner as unknown as { def: { valueType: AnySchema } }).def.valueType;
      return {
        ...base,
        kind: 'record',
        value: buildField(valueType, key, [...path, '*'], overrides),
      };
    }
    default:
      return { ...base, kind: 'unsupported', typeName: t };
  }
}

/** Describe every visible field of an object schema, in declaration order. */
export function buildFields(
  schema: z.ZodObject,
  overrides: FieldOverrides = {},
  path: (string | number)[] = [],
): FieldModel[] {
  const out: FieldModel[] = [];
  for (const [key, child] of Object.entries(schema.shape)) {
    const childPath = [...path, key];
    const meta = { ...unwrap(child as AnySchema).meta, ...overrideFor(overrides, childPath) };
    if (meta.hidden) continue;
    out.push(buildField(child as AnySchema, key, childPath, overrides));
  }
  return out;
}

/** Top-level fields split into the Basic and Advanced sections. */
export function buildFormModel(
  schema: z.ZodObject,
  overrides: FieldOverrides = {},
): { basic: FieldModel[]; advanced: FieldModel[] } {
  const fields = buildFields(schema, overrides);
  return { basic: fields.filter((f) => !f.advanced), advanced: fields.filter((f) => f.advanced) };
}

/** A sensible starting value for a field (new array item, optional switched on). */
export function defaultValueFor(field: FieldModel): unknown {
  if (field.defaultValue !== undefined) return structuredClone(field.defaultValue);
  switch (field.kind) {
    case 'number': {
      // min may be an exclusive bound (`.positive()` reports 0), so prefer 1 at a zero bound.
      if (field.min === undefined) return 0;
      if (field.min > 0) return field.int ? Math.ceil(field.min) : field.min;
      return Math.min(1, field.max ?? 1);
    }
    case 'enum':
      return field.options[0]?.value ?? '';
    case 'boolean':
      return false;
    case 'string':
      return '';
    case 'object':
      return Object.fromEntries(
        field.fields.filter((f) => !f.optional).map((f) => [f.key, defaultValueFor(f)]),
      );
    case 'array':
      return [];
    case 'record':
      return {};
    case 'unsupported':
      return undefined;
  }
}
