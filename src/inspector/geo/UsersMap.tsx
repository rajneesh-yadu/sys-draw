/**
 * Scenario editor (S10): a world map of where users are, one number per user region, and the
 * cloud regions this board's Region groups run in. Every edit is one `updateScenario` command.
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { registry } from '@/registry';
import { useBoardStore, type ProviderId } from '@/store';
import type { CommitResult } from '../form/SchemaForm';
import {
  compactCount,
  MAP_VIEWBOX,
  markerRadius,
  parseUsers,
  project,
  setUsers,
  userRows,
  type UserRow,
} from './users-model';
import { LAND_PATH } from './world-land';

export function UsersMap({
  usersByRegion,
  providerId,
  onCommit,
}: {
  usersByRegion: Readonly<Record<string, number>>;
  providerId: ProviderId;
  onCommit: (next: Record<string, number>) => CommitResult;
}) {
  const rows = userRows(usersByRegion);
  const total = rows.reduce((s, r) => s + r.users, 0);
  const groups = useBoardStore((s) => s.doc.graph.groups);
  const provider = registry.get(providerId, 'provider') ?? registry.get('generic', 'provider');
  const placed = [
    ...new Map(
      groups
        .map((g) => provider?.regions.find((r) => r.id === g.regionId))
        .filter((r) => r !== undefined)
        .map((r) => [r.id, r]),
    ).values(),
  ];
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [active, setActive] = useState<string | null>(null);
  const focus = (id: string) => {
    setActive(id);
    const el = inputs.current.get(id);
    el?.focus();
    el?.select();
  };
  const commit = (id: string, users: number) => onCommit(setUsers(usersByRegion, id, users));

  return (
    <div className="space-y-2" data-testid="users-map">
      <svg
        viewBox={MAP_VIEWBOX}
        className="w-full rounded border border-slate-200 bg-sky-50/60 dark:border-slate-700 dark:bg-slate-950"
        role="group"
        aria-label={`World map: ${compactCount(total)} users${placed.length > 0 ? `; servers in ${placed.map((p) => p.id).join(', ')}` : ''}`}
      >
        <path d={LAND_PATH} className="fill-slate-300 dark:fill-slate-700" />
        {placed.map((r) => {
          const p = project(r.lat, r.lon);
          return (
            <g key={r.id} data-testid="map-cloud-region" data-region-id={r.id}>
              <title>{`${r.name} (${r.id}) — a Region group on this board`}</title>
              <rect
                x={p.x - 8}
                y={p.y - 8}
                width={16}
                height={16}
                className="fill-violet-600 stroke-white"
                strokeWidth={1.5}
              />
              <text
                x={p.x + 11}
                y={p.y + 8}
                className="fill-violet-800 text-[22px] font-semibold dark:fill-violet-300"
              >
                {r.id}
              </text>
            </g>
          );
        })}
        {rows
          .filter(
            (r): r is UserRow & { lat: number; lon: number } =>
              r.lat !== undefined && r.lon !== undefined,
          )
          .map((r) => {
            const p = project(r.lat, r.lon);
            const rad = markerRadius(r.share);
            const on = active === r.id;
            return (
              <g
                key={r.id}
                data-testid="map-user-region"
                data-region-id={r.id}
                className="cursor-pointer"
                onClick={() => focus(r.id)}
                aria-hidden
              >
                <title>{`${r.name}: ${r.users.toLocaleString('en-US')} users — click to edit`}</title>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={rad}
                  className={`${r.users > 0 ? 'fill-sky-500/60' : 'fill-slate-400/30'} ${on ? 'stroke-sky-900 dark:stroke-white' : 'stroke-sky-700/70'}`}
                  strokeWidth={on ? 3 : 1.5}
                />
                {r.users > 0 && (
                  <text
                    x={p.x}
                    y={p.y + 8}
                    textAnchor="middle"
                    className="pointer-events-none fill-slate-900 text-[22px] font-semibold dark:fill-white"
                  >
                    {compactCount(r.users)}
                  </text>
                )}
              </g>
            );
          })}
      </svg>
      <p className="text-[11px] text-slate-500">
        Concurrent users at each region’s local peak. Total {total.toLocaleString('en-US')}.
        {placed.length === 0 && ' Put servers in a Region group to simulate distance.'}
      </p>
      <ul className="space-y-1" aria-label="Users by region">
        {rows.map((r) => (
          <UserRowInput
            key={r.id}
            row={r}
            onActive={() => setActive(r.id)}
            inputRef={(el) => {
              if (el) inputs.current.set(r.id, el);
              else inputs.current.delete(r.id);
            }}
            onCommit={(n) => commit(r.id, n)}
          />
        ))}
      </ul>
    </div>
  );
}

function UserRowInput({
  row,
  onCommit,
  onActive,
  inputRef,
}: {
  row: UserRow;
  onCommit: (users: number) => CommitResult;
  onActive: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? String(row.users);
  const apply = () => {
    if (draft === null) return;
    const p = parseUsers(draft);
    if (!p.ok) return setError(p.error);
    if (p.value === row.users) {
      setDraft(null);
      setError(null);
      return;
    }
    const res = onCommit(p.value);
    if (res.ok) {
      setDraft(null);
      setError(null);
    } else setError(res.reason);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') apply();
    if (e.key === 'Escape') {
      setDraft(null);
      setError(null);
    }
  };
  return (
    <li data-region-id={row.id}>
      <div className="flex items-center gap-2 text-xs">
        <label
          htmlFor={id}
          className="min-w-0 flex-1 truncate"
          title={row.known ? row.name : `Unknown region id "${row.id}": no location`}
        >
          {row.name}
          {!row.known && <span className="text-amber-700 dark:text-amber-300"> (unknown)</span>}
        </label>
        <span className="w-9 text-right text-[10px] text-slate-500 tabular-nums">
          {row.users > 0 ? `${Math.round(row.share * 100)}%` : ''}
        </span>
        <input
          ref={inputRef}
          id={id}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          aria-label={`${row.name} users`}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? `${id}-err` : undefined}
          value={value}
          onFocus={onActive}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={apply}
          onKeyDown={onKey}
          className={`w-24 rounded border px-1.5 py-0.5 text-right tabular-nums dark:bg-slate-900 ${
            error ? 'border-red-500' : 'border-slate-300 dark:border-slate-700'
          }`}
        />
      </div>
      {error !== null && (
        <p id={`${id}-err`} role="alert" className="text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
