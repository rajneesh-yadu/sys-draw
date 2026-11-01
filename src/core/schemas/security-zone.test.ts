import { describe, expect, it } from 'vitest';
import { GroupSchema, SECURITY_ZONES } from './index';

describe('S16 — group zones', () => {
  const base = { id: 'grp_a', kind: 'subnet', label: 'A' };
  it('accepts the four zones, optional and additive (older groups still validate)', () => {
    expect(SECURITY_ZONES).toEqual(['public', 'dmz', 'private', 'data']);
    for (const zone of SECURITY_ZONES)
      expect(
        GroupSchema.safeParse({ ...base, security: { public: false, firewallRules: [], zone } })
          .success,
      ).toBe(true);
    expect(
      GroupSchema.safeParse({ ...base, security: { public: true, firewallRules: [] } }).success,
    ).toBe(true);
    expect(GroupSchema.safeParse(base).success).toBe(true);
  });
  it('rejects an unknown zone', () => {
    expect(
      GroupSchema.safeParse({
        ...base,
        security: { public: false, firewallRules: [], zone: 'dmz2' },
      }).success,
    ).toBe(false);
  });
});
