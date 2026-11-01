/** Sandbox: build anything; live metrics and review findings are optional help; no success. */
import { defineMode } from '../define';

export type SandboxState = Record<string, never>;

export default defineMode<SandboxState>({
  id: 'sandbox',
  label: 'Sandbox',
  description: 'Free build: any components, any traffic, nothing judged.',
  help: 'Live metrics and review findings, all optional',
  success: 'None; free play',
  order: 0,
  hintsAllowed: true,
  wantsProblem: false,
  onEnter: () => ({}),
  onGraphChange: (s) => s,
  onSimResult: (s) => s,
  isComplete: () => false,
});
