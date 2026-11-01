/** `defineMode`: validates a mode controller entry at load time (like the registry's define*). */
import { z } from 'zod';
import type { AnyModeController, ModeController } from './types';

const MODE_ID_RE = /^[a-z][a-z-]*$/;
const fn = (name: string) =>
  z.custom<(...args: never[]) => unknown>((v) => typeof v === 'function', {
    message: `${name} must be a function`,
  });

const ModeControllerSchema = z.object({
  id: z.string().regex(MODE_ID_RE, 'Mode ids are lower-case words'),
  label: z.string().min(1),
  description: z.string().min(1),
  help: z.string().min(1),
  success: z.string().min(1),
  order: z.number().finite(),
  hintsAllowed: z.boolean(),
  wantsProblem: z.boolean(),
  onEnter: fn('onEnter'),
  onGraphChange: fn('onGraphChange'),
  onSimResult: fn('onSimResult'),
  onTick: fn('onTick').optional(),
  onAction: fn('onAction').optional(),
  isComplete: fn('isComplete'),
  score: fn('score').optional(),
  needsReferenceCost: fn('needsReferenceCost').optional(),
  subject: fn('subject').optional(),
});

export class ModeDefinitionError extends Error {}

const MODE_BRAND = Symbol.for('sysdraw.mode');

export function defineMode<S>(controller: ModeController<S>): ModeController<S> {
  const parsed = ModeControllerSchema.safeParse(controller);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ModeDefinitionError(`Invalid mode "${String(controller.id)}": ${issues}`);
  }
  return Object.freeze(Object.assign({ [MODE_BRAND]: true }, controller));
}

export function isModeController(v: unknown): v is AnyModeController {
  return typeof v === 'object' && v !== null && MODE_BRAND in v;
}
