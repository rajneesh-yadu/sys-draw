/** Requirements, scale numbers and rubric of a problem (shared by the browser and the brief). */
import {
  companyLabel,
  companyStyles,
  formatBytes,
  formatCount,
  formatReadWrite,
  LEVEL_LABELS,
  presetPeakRps,
  rubricLines,
  topicTags,
  type Problem,
} from './library';

export function LevelBadge({ level }: { level: number }) {
  return (
    <span
      className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
      data-testid="problem-level"
    >
      L{level} · {LEVEL_LABELS[level] ?? ''}
    </span>
  );
}

export function TagList({ problem }: { problem: Problem }) {
  const companies = companyStyles(problem);
  return (
    <div className="flex flex-wrap gap-1 text-[11px]">
      {companies.map((c) => (
        <span
          key={`c-${c}`}
          className="rounded border border-indigo-200 px-1.5 py-0.5 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300"
        >
          {companyLabel(c)}-style
        </span>
      ))}
      {topicTags(problem).map((t) => (
        <span
          key={t}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function ProblemDetails({ problem }: { problem: Problem }) {
  const s = problem.scale;
  const peak = presetPeakRps(problem.scenario);
  const users = Object.values(problem.scenario.usersByRegion).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4 text-sm" data-testid="problem-details">
      <p className="text-slate-600 dark:text-slate-300">{problem.docs.summary}</p>
      <Section title="Functional requirements">
        <ul className="list-disc space-y-0.5 pl-5">
          {problem.requirements.functional.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Section>
      <Section title="Non-functional requirements">
        <ul className="list-disc space-y-0.5 pl-5">
          {problem.requirements.nonFunctional.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Section>
      <Section title="Scale">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" data-testid="problem-scale">
          <dt className="text-slate-500">Daily active users</dt>
          <dd>{formatCount(s.dau)}</dd>
          <dt className="text-slate-500">Read / write ratio</dt>
          <dd>{formatReadWrite(s.readWriteRatio)}</dd>
          <dt className="text-slate-500">Data size</dt>
          <dd>{formatBytes(s.dataSizeBytes)}</dd>
          <dt className="text-slate-500">Scenario: concurrent users</dt>
          <dd>
            {formatCount(users)} in {Object.keys(problem.scenario.usersByRegion).join(', ')}
          </dd>
          <dt className="text-slate-500">Scenario: peak load</dt>
          <dd>
            ≈ {formatCount(Math.round(peak))} requests/s (
            {problem.scenario.flows.map((f) => f.name).join(', ')})
          </dd>
        </dl>
      </Section>
      <Section title="How it is judged">
        <ul className="space-y-0.5 text-xs" data-testid="problem-rubric">
          {rubricLines(problem).map((r) => (
            <li key={r.text} className="flex gap-2">
              <span className="w-8 shrink-0 text-right text-slate-400">×{r.weight}</span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
