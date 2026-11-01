/** Pure helpers for the scenario's users-per-region map editor (S10). */
import { USER_REGIONS, userRegion } from '@/registry';

export const MAP_WIDTH = 720;
export const MAP_HEIGHT = 360;
/** Visible slice of the map (drops the polar strips). */
export const MAP_VIEWBOX = '0 10 720 290';

/** Equirectangular projection matching LAND_PATH. */
export function project(lat: number, lon: number): { x: number; y: number } {
  return { x: (lon + 180) * 2, y: (90 - lat) * 2 };
}

export interface UserRow {
  id: string;
  name: string;
  users: number;
  /** Share of all users, 0–1 (0 when nobody is anywhere). */
  share: number;
  /** False for ids that are not in the user-region table (old boards). */
  known: boolean;
  lat?: number;
  lon?: number;
}

/** Every known user region (table order) plus any unknown ids the scenario still has. */
export function userRows(usersByRegion: Readonly<Record<string, number>>): UserRow[] {
  const total = Object.values(usersByRegion).reduce((s, u) => s + u, 0);
  const share = (u: number) => (total > 0 ? u / total : 0);
  const rows: UserRow[] = USER_REGIONS.map((r) => {
    const users = usersByRegion[r.id] ?? 0;
    return {
      id: r.id,
      name: r.name,
      users,
      share: share(users),
      known: true,
      lat: r.lat,
      lon: r.lon,
    };
  });
  for (const [id, users] of Object.entries(usersByRegion)) {
    if (!userRegion(id)) rows.push({ id, name: id, users, share: share(users), known: false });
  }
  return rows;
}

/** New record with `id` set to `users`; 0 removes the region (it then has no traffic at all). */
export function setUsers(
  usersByRegion: Readonly<Record<string, number>>,
  id: string,
  users: number,
): Record<string, number> {
  const next = { ...usersByRegion };
  if (users === 0) delete next[id];
  else next[id] = users;
  return next;
}

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

export function parseUsers(text: string): ParseResult {
  const t = text.trim().replace(/[,_\s]/g, '');
  if (t === '') return { ok: true, value: 0 };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number of users' };
  if (n < 0) return { ok: false, error: 'Must be ≥ 0' };
  return { ok: true, value: Math.round(n) };
}

export const MARKER_MIN = 7;
export const MARKER_BASE = 9;
export const MARKER_SCALE = 36;

/** Marker radius on the map: area ∝ share, so a 4× bigger region looks 4× as big. */
export function markerRadius(share: number): number {
  return share <= 0 ? MARKER_MIN : MARKER_BASE + MARKER_SCALE * Math.sqrt(share);
}

export function compactCount(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toPrecision(3)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toPrecision(3)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toPrecision(3)}k`;
  return String(n);
}
