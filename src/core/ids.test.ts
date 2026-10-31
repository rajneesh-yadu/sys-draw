import { describe, expect, it } from 'vitest';
import { idKindOf, idSchema, isId, isRegistryId, newId, randomIdBody } from './ids';

describe('ids', () => {
  it('creates prefixed ids', () => {
    expect(newId('node', 'abc')).toBe('node_abc');
    expect(newId('group', 'x1')).toBe('grp_x1');
    expect(newId('board')).toMatch(/^board_[0-9a-z]{12}$/);
  });
  it('random bodies differ', () => {
    expect(randomIdBody()).not.toBe(randomIdBody());
  });
  it('rejects bad bodies', () => {
    expect(() => newId('node', 'has space')).toThrow(/Invalid node id body/);
    expect(() => newId('node', '')).toThrow();
  });
  it('checks kinds', () => {
    expect(isId('node', 'node_a')).toBe(true);
    expect(isId('node', 'edge_a')).toBe(false);
    expect(isId('edge', 42)).toBe(false);
    expect(idKindOf('grp_vpc')).toBe('group');
    expect(idKindOf('nope')).toBeUndefined();
  });
  it('gives a readable zod error', () => {
    const res = idSchema('node').safeParse('edge_1');
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe('Expected a node id like "node_abc123"');
  });
  it('validates registry ids', () => {
    for (const ok of ['cache.redis', 'proto.http2', 'problem.rate-limiter', 'tls13'])
      expect(isRegistryId(ok)).toBe(true);
    for (const bad of ['Cache.Redis', 'cache..redis', '.x', 'a b', ''])
      expect(isRegistryId(bad)).toBe(false);
  });
});
