/**
 * Back-of-envelope calculator UI: inputs → every estimate with its formula, a "Push to scenario"
 * button (the caller applies the patch; this module only depends on core) and the latency card.
 */
import { Calculator, Send } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { Scenario } from '@/core';
import { Dialog } from './Dialog';
import {
  SIZE_UNITS,
  draftFromInputs,
  inputsFromDraft,
  type EstimatorDraft,
  type SizeUnit,
} from './draft';
import {
  DEFAULT_ESTIMATOR_INPUTS,
  ESTIMATE_SECTION_LABEL,
  estimate,
  type Estimate,
  type EstimateSection,
} from './estimate';
import { LatencyCard } from './LatencyCard';
import { scenarioPatchFromEstimate, type ScenarioPatch } from './scenario';

export type PushResult = { ok: true } | { ok: false; reason: string };

export interface EstimatorProps {
  /** The open board's scenario; needed to preview and build the push. */
  scenario?: Scenario | undefined;
  /** Apply the patch (e.g. dispatch `updateScenario`). Without it there is no push button. */
  onPush?: ((patch: ScenarioPatch) => PushResult) | undefined;
}

// ---------- UI ----------

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm tabular-nums aria-[invalid=true]:border-red-500 dark:border-slate-700 dark:bg-slate-950';
const buttonClass =
  'inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby'?: string;
  }) => React.ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        ...(error || hint ? { 'aria-describedby': msgId } : {}),
      })}
      {(error || hint) && (
        <span
          id={msgId}
          className={`text-[11px] ${error ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

function TextField({
  label,
  hint,
  value,
  error,
  onChange,
  testId,
}: {
  label: string;
  hint?: string;
  value: string;
  error?: string | undefined;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <Field label={label} {...(hint ? { hint } : {})} error={error}>
      {(p) => (
        <input
          {...p}
          type="text"
          inputMode="decimal"
          className={inputClass}
          value={value}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

const SECTIONS: EstimateSection[] = ['traffic', 'storage', 'bandwidth', 'cache'];

export function EstimateResults({ result }: { result: Estimate }) {
  return (
    <div className="flex flex-col gap-3" data-testid="estimate-results">
      {SECTIONS.map((section) => (
        <section key={section} aria-label={ESTIMATE_SECTION_LABEL[section]}>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
            {ESTIMATE_SECTION_LABEL[section]}
          </h3>
          <dl className="flex flex-col divide-y divide-slate-100 rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {result.lines
              .filter((l) => l.section === section)
              .map((l) => (
                <div key={l.id} className="px-2 py-1.5" data-testid={`estimate-${l.id}`}>
                  <div className="flex items-baseline gap-2">
                    <dt className="text-sm text-slate-600 dark:text-slate-300">{l.label}</dt>
                    <dd
                      className="ml-auto text-sm font-semibold tabular-nums"
                      data-testid={`estimate-${l.id}-value`}
                    >
                      {l.display}
                    </dd>
                  </div>
                  <dd className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {l.formula}
                  </dd>
                  <dd className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    = {l.substituted}
                  </dd>
                  {l.note && (
                    <dd className="text-[11px] text-slate-500 dark:text-slate-400">{l.note}</dd>
                  )}
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** The calculator body (inputs, results with formulas, push, latency card). */
export function EstimatorPanel({
  scenario,
  onPush,
  draft: controlledDraft,
  onDraftChange,
}: EstimatorProps & {
  /** Keep the draft outside (so it survives closing the dialog). */
  draft?: EstimatorDraft;
  onDraftChange?: (d: EstimatorDraft) => void;
}) {
  const [localDraft, setLocalDraft] = useState(() => draftFromInputs(DEFAULT_ESTIMATOR_INPUTS));
  const draft = controlledDraft ?? localDraft;
  const setDraft = (d: EstimatorDraft) => {
    setLocalDraft(d);
    onDraftChange?.(d);
  };
  const set = <K extends keyof EstimatorDraft>(k: K, v: EstimatorDraft[K]) =>
    setDraft({ ...draft, [k]: v });

  const parsed = useMemo(() => inputsFromDraft(draft), [draft]);
  // Keep showing the last valid estimate while a field is being fixed.
  const [lastValid, setLastValid] = useState<Estimate>(() => estimate(DEFAULT_ESTIMATOR_INPUTS));
  const current = useMemo(() => (parsed.ok ? estimate(parsed.inputs) : null), [parsed]);
  if (current && current !== lastValid) {
    setLastValid(current);
  }
  const shown = current ?? lastValid;
  const errors = parsed.ok ? {} : parsed.errors;

  const push = useMemo(
    () => (current && scenario ? scenarioPatchFromEstimate(current, scenario) : null),
    [current, scenario],
  );
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const doPush = () => {
    if (!push || !onPush) return;
    const res = onPush(push.patch);
    setStatus(
      res.ok
        ? { kind: 'ok', text: `Scenario updated: ${push.summary}.` }
        : { kind: 'error', text: res.reason },
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="estimator-panel">
      <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <form
          aria-label="Estimator inputs"
          className="flex flex-col gap-2"
          onSubmit={(e) => e.preventDefault()}
        >
          <TextField
            label="Daily active users (DAU)"
            hint="Suffixes ok: 500k, 100M, 1.2B"
            value={draft.dau}
            error={errors.dau}
            onChange={(v) => set('dau', v)}
            testId="est-dau"
          />
          <TextField
            label="Requests per user per day"
            value={draft.actionsPerUserPerDay}
            error={errors.actionsPerUserPerDay}
            onChange={(v) => set('actionsPerUserPerDay', v)}
            testId="est-actions"
          />
          <fieldset className="flex flex-col gap-0.5">
            <legend className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Read : write ratio
            </legend>
            <div className="flex items-center gap-1">
              <input
                aria-label="Read part"
                className={inputClass}
                inputMode="decimal"
                value={draft.readRatio}
                aria-invalid={Boolean(errors.readRatio)}
                data-testid="est-read"
                onChange={(e) => set('readRatio', e.target.value)}
              />
              <span aria-hidden>:</span>
              <input
                aria-label="Write part"
                className={inputClass}
                inputMode="decimal"
                value={draft.writeRatio}
                aria-invalid={Boolean(errors.writeRatio)}
                data-testid="est-write"
                onChange={(e) => set('writeRatio', e.target.value)}
              />
            </div>
            {(errors.readRatio ?? errors.writeRatio) && (
              <span className="text-[11px] text-red-600 dark:text-red-400" role="alert">
                {errors.readRatio ?? errors.writeRatio}
              </span>
            )}
          </fieldset>
          <Field label="Average object size" error={errors.objectSizeBytes}>
            {(p) => (
              <div className="flex gap-1">
                <input
                  {...p}
                  className={inputClass}
                  inputMode="decimal"
                  value={draft.objectSize}
                  data-testid="est-size"
                  onChange={(e) => set('objectSize', e.target.value)}
                />
                <select
                  aria-label="Object size unit"
                  className="rounded border border-slate-300 bg-white px-1 text-sm dark:border-slate-700 dark:bg-slate-950"
                  value={draft.objectSizeUnit}
                  data-testid="est-size-unit"
                  onChange={(e) => set('objectSizeUnit', e.target.value as SizeUnit)}
                >
                  {SIZE_UNITS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Field>
          <TextField
            label="Retention (years)"
            value={draft.retentionYears}
            error={errors.retentionYears}
            onChange={(v) => set('retentionYears', v)}
            testId="est-retention"
          />
          <TextField
            label="Peak factor (busiest hour ÷ average)"
            hint="Typical: 2–5"
            value={draft.peakFactor}
            error={errors.peakFactor}
            onChange={(v) => set('peakFactor', v)}
            testId="est-peak"
          />
          <TextField
            label="Replication factor"
            hint="Copies of each object, e.g. 3"
            value={draft.replicationFactor}
            error={errors.replicationFactor}
            onChange={(v) => set('replicationFactor', v)}
            testId="est-replication"
          />
          <TextField
            label="Hot data to cache (%)"
            hint="80/20 rule: 20"
            value={draft.hotDataPercent}
            error={errors.hotDataFraction}
            onChange={(v) => set('hotDataPercent', v)}
            testId="est-hot"
          />

          {onPush && (
            <div className="mt-2 flex flex-col gap-1 rounded border border-slate-200 p-2 dark:border-slate-800">
              <button
                type="button"
                className={`${buttonClass} justify-center`}
                disabled={!push}
                onClick={doPush}
                data-testid="estimator-push"
              >
                <Send size={14} aria-hidden /> Push to scenario
              </button>
              {push ? (
                <ul
                  className="list-disc pl-4 text-[11px] text-slate-500 dark:text-slate-400"
                  aria-label="What the push changes"
                >
                  <li>
                    Sets users, request rate, peak ×{shown.inputs.peakFactor} and payloads (
                    {push.summary}).
                  </li>
                  {push.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {scenario ? 'Fix the inputs to push.' : 'Open a board to push.'}
                </span>
              )}
              {status && (
                <p
                  role="status"
                  data-testid="estimator-push-status"
                  className={`text-xs ${status.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                >
                  {status.text}
                </p>
              )}
            </div>
          )}
        </form>

        <div aria-live="polite" className={current ? '' : 'opacity-60'}>
          {!current && (
            <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
              Showing the last valid estimate — fix the highlighted inputs.
            </p>
          )}
          <EstimateResults result={shown} />
        </div>
      </div>
      <LatencyCard />
    </div>
  );
}

/** Top-bar button that opens the calculator in a dialog; the draft survives closing it. */
export function EstimatorButton({ scenario, onPush }: EstimatorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFromInputs(DEFAULT_ESTIMATOR_INPUTS));
  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={() => setOpen(true)}
        data-testid="open-estimator"
      >
        <Calculator size={14} aria-hidden /> Estimate
      </button>
      {open && (
        <Dialog
          title="Back-of-envelope estimate"
          onClose={() => setOpen(false)}
          testId="estimator-dialog"
          wide
        >
          <EstimatorPanel
            scenario={scenario}
            onPush={onPush}
            draft={draft}
            onDraftChange={setDraft}
          />
        </Dialog>
      )}
    </>
  );
}
