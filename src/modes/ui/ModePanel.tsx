/**
 * The mode's side panel beside the canvas: what help this mode gives, how success is judged, and
 * the mode's own panel. Sandbox has none (free play).
 */
import { Target } from 'lucide-react';
import type { ChaosState } from '../controllers/chaos';
import type { DebugState } from '../controllers/debug';
import type { LearnState } from '../controllers/learn';
import type { GuidedState } from '../guided';
import type { InterviewState } from '../interview';
import { modes } from '../registry';
import { ChaosPanel } from './ChaosPanel';
import { useModeContext, useModeStore } from './context';
import { DebugPanel } from './DebugPanel';
import { GuidedPanel } from './GuidedPanel';
import { InterviewPanel } from './InterviewPanel';
import { LearnPanel } from './LearnPanel';
import { ProblemPicker } from './ProblemPicker';

export interface ModeNotice {
  kind: 'info' | 'error';
  text: string;
}

export function ModePanel({ onNotice }: { onNotice?: (n: ModeNotice) => void } = {}) {
  const session = useModeStore((s) => s.session);
  const act = useModeStore((s) => s.act);
  const ctx = useModeContext();
  if (!session || session.modeId === 'sandbox' || session.boardId !== ctx.boardId) return null;
  const c = modes.get(session.modeId);
  if (!c) return null;
  const onError = (text: string) => onNotice?.({ kind: 'error', text });
  const body = (() => {
    switch (session.modeId) {
      case 'guided':
        return <GuidedPanel state={session.state as GuidedState} ctx={ctx} act={act} />;
      case 'interview':
        return <InterviewPanel state={session.state as InterviewState} ctx={ctx} act={act} />;
      case 'debug':
        return (
          <DebugPanel state={session.state as DebugState} ctx={ctx} act={act} onError={onError} />
        );
      case 'chaos':
        return <ChaosPanel state={session.state as ChaosState} ctx={ctx} onError={onError} />;
      case 'learn':
        return (
          <LearnPanel state={session.state as LearnState} ctx={ctx} act={act} onError={onError} />
        );
      default:
        return null;
    }
  })();
  return (
    <aside
      aria-label={`${c.label} mode`}
      data-testid="mode-panel"
      data-mode={c.id}
      data-complete={session.complete}
      className="flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-950"
    >
      <header className="space-y-0.5 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <Target className="h-4 w-4 text-indigo-600" aria-hidden /> {c.label} mode
          {ctx.problem && c.id !== 'learn' && (
            <span className="truncate text-xs font-normal text-slate-500">
              · {ctx.problem.title}
            </span>
          )}
        </h2>
        <p className="text-xs text-slate-500">
          <span className="font-medium">Help:</span> {c.help}.{' '}
          <span className="font-medium">Success:</span> {c.success}.
        </p>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {c.wantsProblem && !ctx.problem && c.id !== 'debug' && <ProblemPicker onError={onError} />}
        {body}
      </div>
    </aside>
  );
}
