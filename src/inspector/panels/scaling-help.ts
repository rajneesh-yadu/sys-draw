/**
 * Help for the node's shared Scaling fields (replicas, instance type, autoscale). Each component
 * may say what these mean for it with `.meta({ scalingHelp: { replicas, autoscale?,
 * instanceType? } })` on its configSchema (registry convention, S23 field help); anything it
 * leaves out falls back to the generic text. Pure: no React.
 */
import type { EntryByKind } from '@/registry';

type ComponentDefinition = EntryByKind['component'];

export interface ScalingFieldHelp {
  replicas: string;
  instanceType: string;
  autoscale: string;
}

export const GENERIC_SCALING_HELP: Readonly<ScalingFieldHelp> = Object.freeze({
  replicas: 'Identical instances behind a load balancer (scale out)',
  instanceType: 'Size of each instance (scale up)',
  autoscale: 'Add or remove replicas to hold a target utilisation',
});

const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

/** The component's declared scaling help, with generic text for anything it does not declare. */
export function scalingHelpFor(def: ComponentDefinition | undefined): ScalingFieldHelp {
  const schema = def?.configSchema as
    { meta?: () => Record<string, unknown> | undefined } | undefined;
  const raw = schema?.meta?.()?.scalingHelp;
  const own = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    replicas: text(own.replicas) ?? GENERIC_SCALING_HELP.replicas,
    instanceType: text(own.instanceType) ?? GENERIC_SCALING_HELP.instanceType,
    autoscale: text(own.autoscale) ?? GENERIC_SCALING_HELP.autoscale,
  };
}
