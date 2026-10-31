/**
 * <SchemaForm>: renders a form generated from a Zod object schema. Each committed edit (blur/Enter
 * for text and numbers, change for selects and switches, add/remove for lists) is validated
 * against the whole schema first; an invalid value shows its reason and is not sent. A valid one
 * is passed to `onCommit` as a one-key patch — the panel dispatches it as one undoable command.
 */
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type InputHTMLAttributes,
} from 'react';
import type { z } from 'zod';
import { buildFormModel, defaultValueFor, type FieldModel, type FieldOverrides } from './model';
import { errorAt, getAtPath, issuesByPath, pathKey, setAtPath } from './validate';

export type CommitResult = { ok: true } | { ok: false; reason: string };

export interface SchemaFormProps {
  schema: z.ZodObject;
  value: Record<string, unknown>;
  /** Called with `{ [topLevelKey]: newValue }` (`undefined` = clear an optional field). */
  onCommit: (patch: Record<string, unknown>) => CommitResult;
  overrides?: FieldOverrides;
  /** Accessible name for the form. */
  label: string;
  /** Render only these sections (default both; Advanced is collapsed). */
  sections?: readonly ('basic' | 'advanced')[];
}

interface FormCtx {
  value: Record<string, unknown>;
  idBase: string;
  commit: (path: (string | number)[], leaf: unknown) => void;
  errorFor: (path: (string | number)[]) => string | null;
}

const Ctx = createContext<FormCtx | null>(null);
const useForm = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('Field rendered outside <SchemaForm>');
  return c;
};

export function SchemaForm({
  schema,
  value,
  onCommit,
  overrides,
  label,
  sections = ['basic', 'advanced'],
}: SchemaFormProps) {
  const idBase = useId();
  const model = useMemo(() => buildFormModel(schema, overrides), [schema, overrides]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const commit = useCallback(
    (path: (string | number)[], leaf: unknown) => {
      const top = path[0] as string;
      const next = setAtPath(value, path, leaf) as Record<string, unknown>;
      const issues = issuesByPath(schema, next);
      const reason = errorAt(issues, [top]) ?? issues[''] ?? null;
      const key = pathKey(path);
      const res: CommitResult =
        reason !== null ? { ok: false, reason } : onCommit({ [top]: next[top] });
      setErrors((prev) => {
        // Clear every error under this top-level key; keep the new one (if any) on the edited field.
        const kept = Object.fromEntries(
          Object.entries(prev).filter(([k]) => k !== top && !k.startsWith(`${top}.`)),
        );
        return res.ok ? kept : { ...kept, [key]: res.reason };
      });
    },
    [schema, value, onCommit],
  );

  const errorFor = useCallback(
    (path: (string | number)[]) => errors[pathKey(path)] ?? null,
    [errors],
  );
  const ctx = useMemo(
    () => ({ value, idBase, commit, errorFor }),
    [value, idBase, commit, errorFor],
  );

  return (
    <Ctx.Provider value={ctx}>
      <form
        aria-label={label}
        onSubmit={(e) => e.preventDefault()}
        className="space-y-3"
        noValidate
      >
        {sections.includes('basic') && model.basic.map((f) => <Field key={f.key} field={f} />)}
        {sections.includes('advanced') && model.advanced.length > 0 && (
          <details className="group rounded border border-slate-200 dark:border-slate-700">
            <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase select-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none">
              Advanced ({model.advanced.length})
            </summary>
            <div className="space-y-3 px-2 pt-1 pb-2">
              {model.advanced.map((f) => (
                <Field key={f.key} field={f} />
              ))}
            </div>
          </details>
        )}
      </form>
    </Ctx.Provider>
  );
}

// ---------- Field widgets ----------

const inputCls =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none aria-[invalid=true]:border-red-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const smallBtn =
  'rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-800';

function useFieldIds(path: (string | number)[]) {
  const { idBase } = useForm();
  const id = `${idBase}-${pathKey(path).replace(/[^\w-]/g, '_')}`;
  return { id, errId: `${id}-err`, helpId: `${id}-help` };
}

function Help({ field, id }: { field: FieldModel; id: string }) {
  if (field.help === undefined) return null;
  return (
    <p id={id} className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
      {field.help}
    </p>
  );
}

function ErrorText({ id, error }: { id: string; error: string | null }) {
  if (error === null) return null;
  return (
    <p id={id} role="alert" className="mt-0.5 text-xs text-red-600 dark:text-red-400">
      {error}
    </p>
  );
}

function describedBy(field: FieldModel, helpId: string, errId: string, error: string | null) {
  const ids = [field.help !== undefined ? helpId : '', error !== null ? errId : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/** Renders a field by kind; optional objects get an on/off switch. */
export function Field({ field }: { field: FieldModel }) {
  switch (field.kind) {
    case 'number':
      return <NumberField field={field} />;
    case 'string':
      return <StringField field={field} />;
    case 'enum':
      return <EnumField field={field} />;
    case 'boolean':
      return <BooleanField field={field} />;
    case 'object':
      return <ObjectField field={field} />;
    case 'array':
      return <ArrayField field={field} />;
    case 'record':
      return <RecordField field={field} />;
    case 'unsupported':
      return (
        <p className="text-xs text-slate-400">
          {field.label}: not editable here yet ({field.typeName}).
        </p>
      );
  }
}

function FieldLabel({
  htmlFor,
  field,
  unit,
}: {
  htmlFor: string;
  field: FieldModel;
  unit?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-0.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
    >
      {field.label}
      {unit !== undefined && <span className="ml-1 font-normal text-slate-400">({unit})</span>}
      {field.optional && <span className="ml-1 font-normal text-slate-400">optional</span>}
    </label>
  );
}

/** Text-like input that commits on blur or Enter and reverts on Escape. */
function DraftInput({
  id,
  initial,
  onCommit,
  ...rest
}: {
  id: string;
  initial: string;
  onCommit: (text: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'defaultValue' | 'onBlur' | 'onKeyDown'>) {
  return (
    <input
      // Re-mount when the stored value changes (undo/redo), so the draft follows the store.
      key={initial}
      id={id}
      defaultValue={initial}
      className={inputCls}
      onBlur={(e) => {
        if (e.currentTarget.value !== initial) onCommit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.currentTarget.value = initial;
        }
      }}
      {...rest}
    />
  );
}

function NumberField({ field }: { field: Extract<FieldModel, { kind: 'number' }> }) {
  const { value, commit, errorFor } = useForm();
  const { id, errId, helpId } = useFieldIds(field.path);
  const current = getAtPath(value, field.path);
  const error = errorFor(field.path);
  const [parseError, setParseError] = useState<string | null>(null);
  const shown = parseError ?? error;
  return (
    <div>
      <FieldLabel
        htmlFor={id}
        field={field}
        {...(field.unit !== undefined ? { unit: field.unit } : {})}
      />
      <DraftInput
        id={id}
        type="number"
        inputMode={field.int ? 'numeric' : 'decimal'}
        initial={typeof current === 'number' ? String(current) : ''}
        step={field.step ?? (field.int ? 1 : 'any')}
        {...(field.min !== undefined ? { min: field.min } : {})}
        {...(field.max !== undefined ? { max: field.max } : {})}
        aria-invalid={shown !== null}
        aria-describedby={describedBy(field, helpId, errId, shown)}
        onCommit={(text) => {
          const t = text.trim();
          if (t === '') {
            if (field.optional) {
              setParseError(null);
              commit(field.path, undefined);
            } else setParseError('Enter a number');
            return;
          }
          const n = Number(t);
          if (!Number.isFinite(n)) {
            setParseError('Enter a number');
            return;
          }
          setParseError(null);
          commit(field.path, n);
        }}
      />
      <Help field={field} id={helpId} />
      <ErrorText id={errId} error={shown} />
    </div>
  );
}

function StringField({ field }: { field: Extract<FieldModel, { kind: 'string' }> }) {
  const { value, commit, errorFor } = useForm();
  const { id, errId, helpId } = useFieldIds(field.path);
  const current = getAtPath(value, field.path);
  const error = errorFor(field.path);
  return (
    <div>
      <FieldLabel htmlFor={id} field={field} />
      <DraftInput
        id={id}
        type="text"
        initial={typeof current === 'string' ? current : ''}
        aria-invalid={error !== null}
        aria-describedby={describedBy(field, helpId, errId, error)}
        onCommit={(text) =>
          commit(field.path, field.optional && text.trim() === '' ? undefined : text)
        }
      />
      <Help field={field} id={helpId} />
      <ErrorText id={errId} error={error} />
    </div>
  );
}

function EnumField({ field }: { field: Extract<FieldModel, { kind: 'enum' }> }) {
  const { value, commit, errorFor } = useForm();
  const { id, errId, helpId } = useFieldIds(field.path);
  const current = getAtPath(value, field.path);
  const error = errorFor(field.path);
  return (
    <div>
      <FieldLabel htmlFor={id} field={field} />
      <select
        id={id}
        className={inputCls}
        value={current === undefined ? '' : String(current)}
        aria-invalid={error !== null}
        aria-describedby={describedBy(field, helpId, errId, error)}
        onChange={(e) =>
          commit(field.path, field.optional && e.target.value === '' ? undefined : e.target.value)
        }
      >
        {(field.optional || current === undefined) && <option value="">—</option>}
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Help field={field} id={helpId} />
      <ErrorText id={errId} error={error} />
    </div>
  );
}

function BooleanField({ field }: { field: Extract<FieldModel, { kind: 'boolean' }> }) {
  const { value, commit, errorFor } = useForm();
  const { id, errId, helpId } = useFieldIds(field.path);
  const error = errorFor(field.path);
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="h-4 w-4 accent-sky-600 focus-visible:ring-2 focus-visible:ring-sky-500"
          checked={getAtPath(value, field.path) === true}
          aria-invalid={error !== null}
          aria-describedby={describedBy(field, helpId, errId, error)}
          onChange={(e) => commit(field.path, e.target.checked)}
        />
        <label htmlFor={id} className="text-xs font-medium text-slate-700 dark:text-slate-300">
          {field.label}
        </label>
      </div>
      <Help field={field} id={helpId} />
      <ErrorText id={errId} error={error} />
    </div>
  );
}

function ObjectField({ field }: { field: Extract<FieldModel, { kind: 'object' }> }) {
  const { value, commit, errorFor } = useForm();
  const { id, errId, helpId } = useFieldIds(field.path);
  const current = getAtPath(value, field.path);
  const enabled = current !== undefined;
  const error = errorFor(field.path);
  return (
    <fieldset className="rounded border border-slate-200 px-2 pt-1 pb-2 dark:border-slate-700">
      <legend className="px-1 text-xs font-medium text-slate-700 dark:text-slate-300">
        {field.optional ? (
          <span className="flex items-center gap-1.5">
            <input
              id={id}
              type="checkbox"
              role="switch"
              className="h-3.5 w-3.5 accent-sky-600"
              checked={enabled}
              aria-describedby={describedBy(field, helpId, errId, error)}
              onChange={(e) =>
                commit(field.path, e.target.checked ? defaultValueFor(field) : undefined)
              }
            />
            <label htmlFor={id}>{field.label}</label>
          </span>
        ) : (
          field.label
        )}
      </legend>
      <Help field={field} id={helpId} />
      <ErrorText id={errId} error={error} />
      {enabled && (
        <div className="mt-1 space-y-2">
          {field.fields.map((f) => (
            <Field key={f.key} field={f} />
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Re-path an item model to index `i` (the model is built once with index 0). */
function atIndex(item: FieldModel, base: (string | number)[], i: number | string): FieldModel {
  const depth = base.length;
  const fix = (f: FieldModel): FieldModel => {
    const path = [...f.path];
    path[depth] = i;
    const out = { ...f, path } as FieldModel;
    if (out.kind === 'object') out.fields = out.fields.map(fix);
    if (out.kind === 'array') out.item = fix(out.item);
    if (out.kind === 'record') out.value = fix(out.value);
    return out;
  };
  return fix(item);
}

function ArrayField({ field }: { field: Extract<FieldModel, { kind: 'array' }> }) {
  const { value, commit, errorFor } = useForm();
  const { errId, helpId } = useFieldIds(field.path);
  const items = (getAtPath(value, field.path) as unknown[] | undefined) ?? [];
  const error = errorFor(field.path);
  const singular = field.item.label.replace(/s$/, '');
  const itemName = singular.toLowerCase();
  return (
    <fieldset className="rounded border border-slate-200 px-2 pt-1 pb-2 dark:border-slate-700">
      <legend className="px-1 text-xs font-medium text-slate-700 dark:text-slate-300">
        {field.label} <span className="font-normal text-slate-400">({items.length})</span>
      </legend>
      <Help field={field} id={helpId} />
      <ul className="space-y-2">
        {items.map((_, i) => {
          const itemField = {
            ...atIndex(field.item, field.path, i),
            label: `${singular} ${i + 1}`,
          };
          return (
            <li key={i} className="relative">
              <Field field={itemField as FieldModel} />
              <button
                type="button"
                className={`${smallBtn} mt-1`}
                aria-label={`Remove ${itemName} ${i + 1}`}
                onClick={() =>
                  commit(
                    field.path,
                    items.filter((__, j) => j !== i),
                  )
                }
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={`${smallBtn} mt-1 border border-slate-300 dark:border-slate-600`}
        onClick={() => commit(field.path, [...items, defaultValueFor(field.item)])}
      >
        + Add {itemName}
      </button>
      <ErrorText id={errId} error={error} />
    </fieldset>
  );
}

function RecordField({ field }: { field: Extract<FieldModel, { kind: 'record' }> }) {
  const { value, commit, errorFor } = useForm();
  const { id, errId, helpId } = useFieldIds(field.path);
  const rec = (getAtPath(value, field.path) as Record<string, unknown> | undefined) ?? {};
  const entries = Object.entries(rec);
  const error = errorFor(field.path);
  const rename = (from: string, to: string) => {
    const t = to.trim();
    if (t === from) return;
    commit(field.path, Object.fromEntries(entries.map(([k, v]) => [k === from ? t : k, v])));
  };
  const newKey = () => {
    let i = entries.length + 1;
    while (`key-${i}` in rec) i++;
    return `key-${i}`;
  };
  return (
    <fieldset className="rounded border border-slate-200 px-2 pt-1 pb-2 dark:border-slate-700">
      <legend className="px-1 text-xs font-medium text-slate-700 dark:text-slate-300">
        {field.label}
      </legend>
      <Help field={field} id={helpId} />
      <ul className="space-y-2">
        {entries.map(([k], i) => {
          const valueField = { ...atIndex(field.value, field.path, k), label: k } as FieldModel;
          return (
            <li key={`${i}`} className="grid grid-cols-[1fr_auto] items-end gap-1">
              <div className="space-y-1">
                <label htmlFor={`${id}-k${i}`} className="sr-only">
                  Key {i + 1}
                </label>
                <DraftInput id={`${id}-k${i}`} initial={k} onCommit={(t) => rename(k, t)} />
                <Field field={valueField} />
              </div>
              <button
                type="button"
                className={smallBtn}
                aria-label={`Remove ${k}`}
                onClick={() =>
                  commit(field.path, Object.fromEntries(entries.filter(([x]) => x !== k)))
                }
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={`${smallBtn} mt-1 border border-slate-300 dark:border-slate-600`}
        onClick={() => commit(field.path, { ...rec, [newKey()]: defaultValueFor(field.value) })}
      >
        + Add entry
      </button>
      <ErrorText id={errId} error={error} />
    </fieldset>
  );
}
