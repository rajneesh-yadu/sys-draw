/** Typed reads of a compiled node's config (behaviors read their own documented keys). */
import type { CompiledNode } from '../../model/types';

export function num(node: CompiledNode, key: string): number | undefined {
  const v = node.config[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function str(node: CompiledNode, key: string): string | undefined {
  const v = node.config[key];
  return typeof v === 'string' ? v : undefined;
}

export function bool(node: CompiledNode, key: string): boolean | undefined {
  const v = node.config[key];
  return typeof v === 'boolean' ? v : undefined;
}

/** Service times as the work of one request (capacity) and as what the caller waits for. */
export function responseOf(node: CompiledNode): { read: number; write: number } {
  return node.responseServiceMs ?? node.serviceTimeMs;
}
