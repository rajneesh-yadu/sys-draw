/**
 * "Security" overlay and review state (S16). The canvas only renders it: the app computes the
 * view with the security module (zones, exposure, encryption, findings) and registers the
 * handler that applies a finding's one-click fix through the board store.
 *
 * The view types mirror the security module's `SecurityOverlay` / `SecurityFinding` (canvas may
 * not import it); the app maps one onto the other, so TypeScript checks they stay in step.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

export type SecuritySeverity = 'info' | 'warning' | 'error' | 'critical';
export type SecurityExposure = 'internet' | 'exposed' | 'dmz' | 'internal' | 'unzoned';
export type SecurityEncryption = 'mtls' | 'tls' | 'plaintext' | 'unknown';

export interface SecurityViewFinding {
  key: string;
  ruleId: string;
  severity: SecuritySeverity;
  title: string;
  message: string;
  fix?: string | undefined;
  /** Present when the finding has a one-click fix. */
  fixLabel?: string | undefined;
  targetIds: readonly string[];
}

export interface SecurityView {
  nodes: Readonly<Record<string, { exposure: SecurityExposure; label: string; reason: string }>>;
  edges: Readonly<
    Record<
      string,
      {
        encryption: SecurityEncryption;
        label: string;
        crossing?:
          { explain: string; verdict?: 'allow' | 'deny' | 'no-rules' | undefined } | undefined;
      }
    >
  >;
  /** Zone label per group id ("Public", "Data"…), own or inherited. */
  groups: Readonly<Record<string, string>>;
  findings: readonly SecurityViewFinding[];
}

export type FixHandler = (
  key: string,
) => { ok: true; label: string } | { ok: false; reason: string };

export interface SecurityState {
  /** Overlay + review panel shown. */
  open: boolean;
  view: SecurityView | null;
  /** Result of the last fix, for the panel's status line. */
  lastFix: { ok: boolean; message: string } | null;
  fixHandler: FixHandler | null;
  setOpen(open: boolean): void;
  setView(view: SecurityView | null): void;
  setFixHandler(fn: FixHandler | null): void;
  /** Applies a finding's fix through the registered handler. */
  fix(key: string): void;
}

export type SecurityStore = StoreApi<SecurityState>;

export function createSecurityStore(): SecurityStore {
  return createStore<SecurityState>()((set, get) => ({
    open: false,
    view: null,
    lastFix: null,
    fixHandler: null,
    setOpen: (open) => set({ open, ...(open ? {} : { lastFix: null }) }),
    setView: (view) => set({ view }),
    setFixHandler: (fixHandler) => set({ fixHandler }),
    fix: (key) => {
      const h = get().fixHandler;
      if (!h) return set({ lastFix: { ok: false, message: 'Fixes are not available here.' } });
      const r = h(key);
      set({
        lastFix: r.ok
          ? { ok: true, message: `Applied: ${r.label} (undo with Ctrl/⌘+Z)` }
          : { ok: false, message: r.reason },
      });
    },
  }));
}

export const SEVERITY_ORDER: readonly SecuritySeverity[] = ['critical', 'error', 'warning', 'info'];

export function severityCounts(
  findings: readonly SecurityViewFinding[],
): Record<SecuritySeverity, number> {
  const out: Record<SecuritySeverity, number> = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const f of findings) out[f.severity] += 1;
  return out;
}

/** Overlay colours (stroke/border) and text, so meaning never rests on colour alone. */
export const EXPOSURE_STYLE: Record<SecurityExposure, { border: string; pill: string }> = {
  internet: {
    border: 'border-slate-400',
    pill: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  },
  exposed: {
    border: 'border-red-600 dark:border-red-500',
    pill: 'bg-red-600 text-white dark:bg-red-500',
  },
  dmz: {
    border: 'border-amber-500 dark:border-amber-400',
    pill: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  },
  internal: {
    border: 'border-emerald-600 dark:border-emerald-500',
    pill: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  },
  unzoned: {
    border: 'border-dashed border-slate-400',
    pill: 'bg-white text-slate-600 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-600',
  },
};

export const ENCRYPTION_STROKE: Record<SecurityEncryption, { stroke: string; dashed: boolean }> = {
  mtls: { stroke: '#047857', dashed: false },
  tls: { stroke: '#059669', dashed: false },
  plaintext: { stroke: '#dc2626', dashed: true },
  unknown: { stroke: '#94a3b8', dashed: true },
};

export const SEVERITY_STYLE: Record<SecuritySeverity, string> = {
  critical: 'bg-red-700 text-white dark:bg-red-600',
  error: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  info: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
};
