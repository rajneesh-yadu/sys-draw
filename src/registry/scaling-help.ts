/**
 * Per-component help for the node's shared Scaling fields (core `NodeScalingSchema`: replicas,
 * instance type, autoscale). Every component has these fields, but "replicas" means different
 * things per component (interchangeable instances, extra read replicas, cluster nodes, capacity
 * units of a managed service, or nothing at all), so each component says what they mean for it.
 *
 * Declared on the component's `configSchema` with `.meta(scalingHelp({...}))`, the same way
 * fields declare `.meta({ scaling })` roles and `.meta({ perfEffect })`; the inspector reads the
 * `scalingHelp` meta key. Internal to the registry (not exported from index.ts). Help text must
 * describe what the simulation actually does; gaps go to docs/PROGRESS.md as follow-ups.
 */
import { z } from 'zod';

const HelpText = z.string().trim().min(1).max(400);

export const ScalingHelpSchema = z.strictObject({
  /** What `scaling.replicas` is for this component (required). */
  replicas: HelpText,
  /** Only when autoscaling means something different from "add or remove replicas". */
  autoscale: HelpText.optional(),
  /** Only when the instance type means something other than "size of each instance". */
  instanceType: HelpText.optional(),
});
export type ScalingHelp = z.infer<typeof ScalingHelpSchema>;

/** `.meta(scalingHelp({...}))` on a component's configSchema. Validates at import. */
export function scalingHelp(help: ScalingHelp): { scalingHelp: ScalingHelp } {
  return { scalingHelp: ScalingHelpSchema.parse(help) };
}

/**
 * Managed services billed per request ($0/h instance price): replicas only scale the
 * simulated capacity. `what` names the service, e.g. 'managed queue'.
 */
export function managedPerRequest(what: string, extra = ''): ScalingHelp {
  return {
    replicas:
      `Simulated capacity units of the ${what}, which the provider runs and scales for you. ` +
      `More units add modelled throughput; billing is per request, so cost does not change.` +
      (extra ? ` ${extra}` : ''),
    autoscale: 'Adds or removes simulated capacity units; cost stays per request.',
  };
}

/** Managed services with a small hourly fee per unit (hosted zone, key, web ACL…). */
export function managedHourly(what: string, extra = ''): ScalingHelp {
  return {
    replicas:
      `Simulated capacity units of the ${what}, which the provider runs and scales for you. ` +
      `Each unit adds modelled throughput and its hourly fee to the cost; 1 is usually enough.` +
      (extra ? ` ${extra}` : ''),
  };
}
