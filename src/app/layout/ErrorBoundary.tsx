/**
 * S21: error boundaries. Each shell region is wrapped, so a bug in one panel (a bad registry
 * entry, a chart choking on a result) shows a small fallback there instead of a blank app.
 * The workspace is untouched; "Try again" re-mounts the region, and the region also resets on
 * its own when `resetKey` changes (e.g. the open board).
 */
import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Human name of the region ("Inspector"), shown in the fallback. */
  name: string;
  children: ReactNode;
  /** A change of this value clears the error (new board, new selection…). */
  resetKey?: unknown;
  /** Smaller fallback for narrow regions. */
  compact?: boolean;
  /** For tests and logging. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, error: null };
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[sysdraw] ${this.props.name} crashed:`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorFallback
        name={this.props.name}
        error={error}
        onRetry={this.reset}
        compact={this.props.compact ?? false}
      />
    );
  }
}

export function ErrorFallback({
  name,
  error,
  onRetry,
  compact,
}: {
  name: string;
  error: Error;
  onRetry: () => void;
  compact: boolean;
}) {
  const details = `${name}: ${error.message}\n${error.stack ?? ''}`;
  return (
    <div
      role="alert"
      data-testid="error-fallback"
      data-region={name}
      className={`flex flex-col items-start gap-2 text-sm text-slate-700 dark:text-slate-200 ${compact ? 'p-2' : 'p-4'}`}
    >
      <p className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-300">
        <AlertTriangle size={16} aria-hidden />
        {name} hit an error
      </p>
      {!compact && (
        <p className="text-slate-600 dark:text-slate-400">
          Your work is saved; only this panel stopped. Try again, or switch boards.
        </p>
      )}
      <code className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
        {error.message}
      </code>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:border-slate-600 dark:hover:bg-slate-800"
        >
          Try again
        </button>
        {!compact && (
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(details).catch(() => {})}
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Copy details
          </button>
        )}
      </div>
    </div>
  );
}
