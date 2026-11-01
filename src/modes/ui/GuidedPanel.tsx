/** Guided: one step card at a time, its checks, hints on request. */
import { CheckCircle2, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { guidedScore, guidedSteps, type GuidedState } from '../guided';
import { formatCompact } from '../guided';
import type { ModeAction, ModeContext } from '../types';
import { Checks } from './Checks';
import { banner, button, field, primary, sectionTitle } from './styles';

export function GuidedPanel({
  state,
  ctx,
  act,
}: {
  state: GuidedState;
  ctx: ModeContext;
  act: (a: ModeAction) => void;
}) {
  const steps = guidedSteps(state, ctx);
  const i = Math.min(state.step, steps.length - 1);
  const step = steps[i]!;
  const hints = ctx.problem?.hints ?? [];
  return (
    <div className="space-y-3" data-testid="guided-panel">
      {state.completedAtMs !== undefined && (
        <p className={banner} role="status" data-testid="guided-complete">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          All seven steps pass — score {guidedScore(state)}.
        </p>
      )}
      <ol className="flex gap-1" aria-label="Steps">
        {steps.map((s, k) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => act({ type: 'goto', step: k })}
              aria-current={k === i ? 'step' : undefined}
              aria-label={`Step ${k + 1}: ${s.title}${s.passed ? ' (passed)' : ''}`}
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                k === i
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : s.passed
                    ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400'
                    : 'border-slate-300 text-slate-500 dark:text-slate-400 dark:border-slate-700'
              }`}
            >
              {s.passed && k !== i ? '✓' : k + 1}
            </button>
          </li>
        ))}
      </ol>

      <section
        className="space-y-2"
        aria-label={`Step ${i + 1}: ${step.title}`}
        data-testid="guided-step"
      >
        <h3 className="text-sm font-semibold">
          {i + 1}. {step.title}
        </h3>
        <p className="text-xs text-slate-700 dark:text-slate-300">{step.prompt}</p>
        <details className="text-xs text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer">Why this step</summary>
          <p className="mt-1">{step.why}</p>
        </details>
        <StepInputs state={state} ctx={ctx} act={act} />
        <h4 className={sectionTitle}>Checks</h4>
        <Checks items={step.items} label="Step checks" />
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={i === 0}
          onClick={() => act({ type: 'goto', step: i - 1 })}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Back
        </button>
        <button
          type="button"
          className={primary}
          disabled={i === steps.length - 1}
          onClick={() => act({ type: 'goto', step: i + 1 })}
        >
          {step.passed ? 'Next step' : 'Skip for now'}{' '}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {hints.length > 0 && (
        <section className="space-y-1" aria-label="Hints">
          <h4 className={sectionTitle}>Hints</h4>
          <ol className="list-decimal space-y-1 pl-4 text-xs">
            {hints.slice(0, state.hintsShown).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
          {state.hintsShown < hints.length && (
            <button type="button" className={button} onClick={() => act({ type: 'hint' })}>
              <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Show a hint (−8 points)
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function StepInputs({
  state,
  ctx,
  act,
}: {
  state: GuidedState;
  ctx: ModeContext;
  act: (a: ModeAction) => void;
}) {
  const id = ['requirements', 'estimates', 'api', 'data-model', 'hld', 'scaling', 'bottlenecks'][
    Math.min(state.step, 6)
  ];
  const note = (step: string, label: string, placeholder: string, rows = 4) => (
    <label className="block text-xs">
      {label}
      <textarea
        className={`${field} font-mono`}
        rows={rows}
        placeholder={placeholder}
        value={state.notes[step as keyof GuidedState['notes']] ?? ''}
        onChange={(e) => act({ type: 'setNote', step, text: e.target.value })}
      />
    </label>
  );
  switch (id) {
    case 'requirements': {
      const p = ctx.problem;
      if (!p)
        return note(
          'requirements',
          'Your requirements, one per line',
          'Users can …\np99 < 200 ms\n…',
        );
      const list = (title: string, items: string[]) => (
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">{title}</legend>
          {items.map((r) => (
            <label key={r} className="flex items-start gap-1.5 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={state.checked.includes(r)}
                onChange={() => act({ type: 'toggleRequirement', text: r })}
              />
              <span>{r}</span>
            </label>
          ))}
        </fieldset>
      );
      return (
        <div className="space-y-2">
          {list('Functional', p.requirements.functional)}
          {list('Non-functional', p.requirements.nonFunctional)}
        </div>
      );
    }
    case 'estimates': {
      const num = (
        fieldName: 'peakRps' | 'storageBytes',
        label: string,
        unit: number,
        suffix: string,
      ) => (
        <label className="flex items-center gap-2 text-xs">
          <span className="w-32">{label}</span>
          <input
            type="number"
            min={0}
            className={`${field} w-28`}
            defaultValue={
              state.estimates[fieldName] !== undefined ? state.estimates[fieldName]! / unit : ''
            }
            onChange={(e) =>
              act({
                type: 'setEstimate',
                field: fieldName,
                value: e.target.value === '' ? NaN : Number(e.target.value) * unit,
              })
            }
          />
          <span className="text-slate-500 dark:text-slate-400">{suffix}</span>
        </label>
      );
      return (
        <div className="space-y-1.5">
          {num('peakRps', 'Peak requests/s', 1, 'rps')}
          {ctx.problem && num('storageBytes', 'Data stored', 1e9, 'GB')}
          {ctx.problem && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Given: {formatCompact(ctx.problem.scale.dau)} daily users,{' '}
              {ctx.problem.scale.readWriteRatio}:1 reads to writes.
            </p>
          )}
        </div>
      );
    }
    case 'api':
      return note('api', 'Endpoints', 'POST /urls\nGET /{alias}');
    case 'data-model':
      return note('data-model', 'Entities', 'Url: alias, longUrl, createdAt, expiresAt');
    case 'bottlenecks':
      return note(
        'bottlenecks',
        'What breaks first at 10× traffic?',
        'The … because …; I would …',
        3,
      );
    default:
      return (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Build on the canvas — these checks update with every simulation.
        </p>
      );
  }
}
