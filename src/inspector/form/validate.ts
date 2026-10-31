/** Validation for generated forms: run the schema, map each issue to a readable reason by path. */
import type { z } from 'zod';

interface Issue {
  code: string;
  path: PropertyKey[];
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  origin?: string;
  expected?: string;
  values?: unknown[];
  /** Nested issues (`invalid_key` on records, `invalid_union`). */
  issues?: Issue[];
}

const fmt = (n: number | bigint | undefined) =>
  typeof n === 'number' ? n.toLocaleString('en-US') : String(n);

/** Zod's default wording ("Too small: expected number to be >=1") rewritten for people. */
export function readableIssue(issue: Issue): string {
  if (issue.code === 'invalid_key' && issue.issues?.[0]) {
    const key = issue.path[issue.path.length - 1];
    return `Key "${String(key)}": ${readableIssue(issue.issues[0])}`;
  }
  const isDefault = /^(Too small|Too big|Invalid input|Invalid option)/.test(issue.message);
  if (!isDefault) return issue.message;
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string') {
        return Number(issue.minimum) <= 1
          ? 'Must not be empty'
          : `Must be at least ${fmt(issue.minimum)} characters`;
      }
      if (issue.origin === 'array') return `Add at least ${fmt(issue.minimum)}`;
      return `Must be ${issue.inclusive === false ? '>' : '≥'} ${fmt(issue.minimum)}`;
    case 'too_big':
      if (issue.origin === 'string') return `Must be at most ${fmt(issue.maximum)} characters`;
      if (issue.origin === 'array') return `At most ${fmt(issue.maximum)} allowed`;
      return `Must be ${issue.inclusive === false ? '<' : '≤'} ${fmt(issue.maximum)}`;
    case 'invalid_type':
      if (issue.expected === 'int') return 'Must be a whole number';
      if (issue.expected === 'number') return 'Enter a number';
      if (issue.expected === 'string') return 'Enter some text';
      return `Expected ${issue.expected ?? 'a value'}`;
    case 'invalid_value':
      return `Choose one of: ${(issue.values ?? []).map(String).join(', ')}`;
    default:
      return issue.message;
  }
}

export const pathKey = (path: readonly PropertyKey[]): string => path.map(String).join('.');

/** Validate `value`; returns readable reasons keyed by dotted path ('' = the whole form). */
export function issuesByPath(schema: z.ZodType, value: unknown): Record<string, string> {
  const res = schema.safeParse(value);
  if (res.success) return {};
  const out: Record<string, string> = {};
  for (const issue of res.error.issues as unknown as Issue[]) {
    const key = pathKey(issue.path);
    out[key] ??= readableIssue(issue);
  }
  return out;
}

/** First reason at `path` or below it (a nested object's error belongs to its field), or null. */
export function errorAt(
  errors: Record<string, string>,
  path: readonly PropertyKey[],
): string | null {
  const key = pathKey(path);
  if (errors[key] !== undefined) return errors[key];
  const prefix = key === '' ? '' : `${key}.`;
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(prefix)) return v;
  return null;
}

/** Immutable set: a copy of `root` with `value` at `path` (`undefined` deletes an object key). */
export function setAtPath(
  root: unknown,
  path: readonly (string | number)[],
  value: unknown,
): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string | number, ...(string | number)[]];
  if (Array.isArray(root)) {
    const copy = [...(root as unknown[])];
    copy[head as number] = setAtPath(copy[head as number], rest, value);
    return copy;
  }
  const obj = { ...((root ?? {}) as Record<string, unknown>) };
  const next = setAtPath(obj[head], rest, value);
  if (next === undefined) delete obj[head];
  else obj[head] = next;
  return obj;
}

export function getAtPath(root: unknown, path: readonly (string | number)[]): unknown {
  let cur = root;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}
