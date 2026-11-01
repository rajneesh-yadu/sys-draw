/**
 * User regions: where a scenario's users live (`Scenario.usersByRegion` keys). Each is a
 * population-weighted point (lat/long), a representative UTC offset for the daily traffic cycle,
 * and a last-mile round trip (home/mobile network → nearest internet exchange).
 * Cloud regions are NOT here: they belong to each provider entry (providers/*.ts → `regions`).
 * Add a user region by adding a row; the table is validated with Zod at import.
 */
import { z } from 'zod';
import { NonEmptyStringSchema, RegionIdSchema } from '@/core';

export const UserRegionSchema = z.strictObject({
  id: RegionIdSchema,
  name: NonEmptyStringSchema,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Representative local time offset from UTC (hours), for the diurnal curve. */
  utcOffsetHours: z.number().min(-12).max(14),
  /** Typical RTT from a user's device to the nearest internet exchange (access network). */
  lastMileMs: z.number().min(0).max(200),
});
export type UserRegion = z.infer<typeof UserRegionSchema>;

const TABLE: UserRegion[] = [
  {
    id: 'north-america',
    name: 'North America',
    lat: 39,
    lon: -95,
    utcOffsetHours: -6,
    lastMileMs: 15,
  },
  { id: 'latam', name: 'Latin America', lat: -8, lon: -55, utcOffsetHours: -4, lastMileMs: 30 },
  { id: 'europe', name: 'Europe', lat: 50, lon: 10, utcOffsetHours: 1, lastMileMs: 15 },
  { id: 'africa', name: 'Africa', lat: 5, lon: 20, utcOffsetHours: 1, lastMileMs: 40 },
  { id: 'middle-east', name: 'Middle East', lat: 27, lon: 45, utcOffsetHours: 3, lastMileMs: 25 },
  {
    id: 'india',
    name: 'India & South Asia',
    lat: 22,
    lon: 79,
    utcOffsetHours: 5.5,
    lastMileMs: 25,
  },
  { id: 'east-asia', name: 'East Asia', lat: 33, lon: 120, utcOffsetHours: 8, lastMileMs: 15 },
  { id: 'se-asia', name: 'Southeast Asia', lat: 5, lon: 110, utcOffsetHours: 7, lastMileMs: 25 },
  { id: 'oceania', name: 'Oceania', lat: -30, lon: 145, utcOffsetHours: 10, lastMileMs: 20 },
];

function validate(rows: readonly UserRegion[]): readonly UserRegion[] {
  const seen = new Set<string>();
  return Object.freeze(
    rows.map((r) => {
      const parsed = UserRegionSchema.parse(r);
      if (seen.has(parsed.id)) throw new Error(`Duplicate user region id "${parsed.id}"`);
      seen.add(parsed.id);
      return Object.freeze(parsed);
    }),
  );
}

/** Every user region, in display order (west → east). */
export const USER_REGIONS: readonly UserRegion[] = validate(TABLE);

const BY_ID = new Map(USER_REGIONS.map((r) => [r.id, r]));

export function userRegion(id: string): UserRegion | undefined {
  return BY_ID.get(id);
}
