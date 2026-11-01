/** "Scale" quick actions row: one click = one store command = one undo step. */
import { useId, useState } from 'react';
import type { EntryByKind } from '@/registry';
import type { NodeInstance } from '@/store';
import { scaleActions } from './scale-actions';
import { useDispatch } from './use-dispatch';

export function ScaleActions({ def, node }: { def: EntryByKind['component']; node: NodeInstance }) {
  const dispatch = useDispatch();
  const base = useId();
  const [error, setError] = useState<string | null>(null);
  const actions = scaleActions(def, node);
  if (actions.length === 0) return null;
  const type = def.instanceTypes.find((t) => t.id === node.scaling.instanceType);

  return (
    <div className="space-y-2" role="group" aria-label="Scale quick actions">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {node.scaling.autoscale ? 'Autoscaling' : `${node.scaling.replicas} ×`}{' '}
        {type
          ? `${type.id} · ${type.vCpu} vCPU · ${type.memGb} GB · $${type.costUsdPerHour}/h each`
          : node.scaling.instanceType}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => {
          const hintId = `${base}-${a.id}`;
          return (
            <span key={a.id}>
              <button
                type="button"
                disabled={a.command === undefined}
                aria-describedby={hintId}
                title={a.disabledReason ?? a.description}
                onClick={() => {
                  if (!a.command) return;
                  const res = dispatch(a.command);
                  setError(res.ok ? null : res.reason);
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {a.label}
              </button>
              <span id={hintId} className="sr-only">
                {a.disabledReason ?? a.description}
              </span>
            </span>
          );
        })}
      </div>
      {error !== null && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
