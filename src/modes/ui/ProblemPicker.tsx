/** "Practise a problem on this board" — for Guided / Interview on a free board. */
import { useState } from 'react';
import { registry } from '@/registry';
import { useBoardStoreApi, useWorkspaceStoreApi } from '@/store';
import { attachProblem } from '../board-actions';
import { button, field } from './styles';

export function ProblemPicker({ onError }: { onError: (msg: string) => void }) {
  const ws = useWorkspaceStoreApi();
  const board = useBoardStoreApi();
  const problems = registry
    .list({ kind: 'problem' })
    .slice()
    .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
  const [id, setId] = useState(problems[0]?.id ?? '');
  return (
    <div
      className="space-y-2 rounded border border-dashed border-slate-300 p-2 dark:border-slate-700"
      data-testid="problem-picker"
    >
      <p className="text-xs text-slate-600 dark:text-slate-300">
        This board has no practice problem. Pick one: its scenario is applied to the board (one undo
        step) and your design stays.
      </p>
      <label className="block text-xs">
        Problem
        <select className={field} value={id} onChange={(e) => setId(e.target.value)}>
          {problems.map((p) => (
            <option key={p.id} value={p.id}>
              L{p.level} · {p.title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={button}
        onClick={() => {
          const p = registry.get(id, 'problem');
          if (!p) return;
          const res = attachProblem(ws, board, p);
          if (!res.ok) onError(res.reason);
        }}
      >
        Practise this problem
      </button>
    </div>
  );
}
