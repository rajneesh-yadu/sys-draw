import type { Finding, FindingSeverity } from '@/core';

/** Engine-generated findings (compile/route problems). Review rules (S19) produce the rest. */
export function engineFinding(
  ruleId: 'engine.compile' | 'engine.route' | 'engine.chaos',
  severity: FindingSeverity,
  title: string,
  message: string,
  targetIds: string[],
): Finding {
  return { ruleId, severity, title, message, targetIds };
}
