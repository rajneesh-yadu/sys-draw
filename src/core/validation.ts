/** Turning Zod failures into short, human-readable messages. */
import type { z } from 'zod';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** ['projects', 0, 'name'] → "projects[0].name"; [] → "(root)". */
export function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += out === '' ? String(seg) : `.${String(seg)}`;
  }
  return out;
}

/** One line per issue: `graph.edges[0].target: Edge target "node_x" is not a node in this graph`. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
}

/** Validate `input` with `schema`, returning a result instead of throwing. */
export function safeParseReadable<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ParseResult<z.output<S>> {
  const res = schema.safeParse(input);
  return res.success
    ? { ok: true, value: res.data }
    : { ok: false, errors: formatIssues(res.error) };
}

/** Thrown by `parseOrThrow`; `errors` holds the readable lines. */
export class ValidationError extends Error {
  readonly errors: string[];
  constructor(what: string, errors: string[]) {
    super(`Invalid ${what}:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  input: unknown,
  what: string,
): z.output<S> {
  const res = safeParseReadable(schema, input);
  if (!res.ok) throw new ValidationError(what, res.errors);
  return res.value;
}
