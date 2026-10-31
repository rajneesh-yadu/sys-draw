/**
 * Shared instance-type presets for generic components (not auto-discovered).
 * Prices are rounded on-demand list prices of comparable general-purpose (m-class) and
 * memory-optimised (r-class) VMs, so cost estimates are in the right order of magnitude.
 */
import type { InstanceType } from '@/core';

export const GENERAL_PURPOSE_INSTANCES = [
  { id: 'small', vCpu: 2, memGb: 8, netGbps: 12.5, costUsdPerHour: 0.096 },
  { id: 'medium', vCpu: 4, memGb: 16, netGbps: 12.5, costUsdPerHour: 0.192 },
  { id: 'large', vCpu: 8, memGb: 32, netGbps: 12.5, costUsdPerHour: 0.384 },
  { id: 'xlarge', vCpu: 16, memGb: 64, netGbps: 25, costUsdPerHour: 0.768 },
] as const satisfies readonly InstanceType[];

export const MEMORY_OPTIMISED_INSTANCES = [
  { id: 'mem-medium', vCpu: 4, memGb: 32, netGbps: 12.5, costUsdPerHour: 0.252 },
  { id: 'mem-large', vCpu: 8, memGb: 64, netGbps: 12.5, costUsdPerHour: 0.504 },
  { id: 'mem-xlarge', vCpu: 16, memGb: 128, netGbps: 25, costUsdPerHour: 1.008 },
] as const satisfies readonly InstanceType[];
