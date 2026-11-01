import { describe, expect, it } from 'vitest';
import { registry, userRegion, USER_REGIONS, UserRegionSchema } from '@/registry';

describe('user regions (S10)', () => {
  it('ships the user regions named in ENGINE.md, all valid and unique', () => {
    const ids = USER_REGIONS.map((r) => r.id);
    for (const id of [
      'north-america',
      'europe',
      'india',
      'se-asia',
      'latam',
      'africa',
      'oceania',
    ]) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of USER_REGIONS) expect(UserRegionSchema.safeParse(r).success).toBe(true);
    expect(userRegion('india')?.utcOffsetHours).toBe(5.5);
    expect(userRegion('mars')).toBeUndefined();
  });

  it('rejects a malformed row', () => {
    expect(
      UserRegionSchema.safeParse({
        id: 'X',
        name: '',
        lat: 100,
        lon: 0,
        utcOffsetHours: 0,
        lastMileMs: 1,
      }).success,
    ).toBe(false);
  });

  it('generic cloud regions: ~25, unique, default kept', () => {
    const p = registry.require('generic', 'provider');
    expect(p.regions.length).toBeGreaterThanOrEqual(25);
    expect(p.regions.some((r) => r.id === p.defaultRegionId)).toBe(true);
  });
});
