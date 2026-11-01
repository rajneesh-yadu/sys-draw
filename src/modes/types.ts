/**
 * The mode contract (MODES.md): six modes share one board and one engine; a mode only changes
 * what help is shown, what is locked and how success is judged. Each is a `ModeController` with
 * pure hooks over its own session state, so new modes are plug-ins (one file in controllers/).
 */
import type { LessonDefinition, Registry, RegistryProblemDefinition } from '@/registry';
import type { Board, Graph, Scenario, SimResult } from '@/store';

export type ModeId = Board['mode'];
export type Problem = RegistryProblemDefinition;
export type Lesson = LessonDefinition;
export type SloTarget = NonNullable<Problem['rubric'][number]['slo']>;

/** What every hook sees: the open board, its problem, the latest result and the clock. */
export interface ModeContext {
  boardId: string;
  graph: Graph;
  scenario: Scenario;
  /** The board's practice problem (undefined on a free board). */
  problem: Problem | undefined;
  /** Latest simulation result for this board (null until the first run). */
  result: SimResult | null;
  registry: Registry;
  /** Wall-clock ms (injected, so hooks stay pure and testable). */
  nowMs: number;
}

/** What a progress record is about: a problem or a lesson. */
export interface ModeSubject {
  kind: 'problem' | 'lesson';
  id: string;
  title: string;
}

/** A user action from the mode panel; each controller defines its own `type`s. */
export interface ModeAction {
  type: string;
  [key: string]: unknown;
}

export interface ModeController<S = unknown> {
  id: ModeId;
  label: string;
  /** One line for the switcher. */
  description: string;
  /** "Help shown" column of MODES.md. */
  help: string;
  /** "Success" column of MODES.md. */
  success: string;
  /** Sort order in the switcher. */
  order: number;
  /** Whether problem hints / the reference may be shown while the session runs. */
  hintsAllowed: boolean;
  /** Offer a problem picker on a free board (Guided, Interview, Debug). */
  wantsProblem: boolean;

  onEnter(ctx: ModeContext): S;
  onGraphChange(state: S, ctx: ModeContext): S;
  onSimResult(state: S, ctx: ModeContext): S;
  /** Clock tick (about once a second) — Interview's timer. */
  onTick?(state: S, ctx: ModeContext): S;
  /** Panel actions (answer a step, finish the interview, take a hint…). */
  onAction?(state: S, action: ModeAction, ctx: ModeContext): S;
  isComplete(state: S, ctx: ModeContext): boolean;
  /** 0–100 for the progress page; undefined = not scored. */
  score?(state: S, ctx: ModeContext): number | undefined;
  /**
   * True when the runner should simulate the problem's reference design and send its monthly cost
   * as `{ type: 'referenceCost', costPerMonth }` (Interview's cost score). Asked once per session.
   */
  needsReferenceCost?(state: S): boolean;
  /** What the attempt counts towards (default: the board's problem). */
  subject?(state: S, ctx: ModeContext): ModeSubject | undefined;
}

/** Any controller (state type erased) — what the registry holds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModeController = ModeController<any>;
