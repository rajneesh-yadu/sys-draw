/**
 * "Scale" quick actions for a node: +1 replica, size up/down, add read replica, shard ×2.
 * Pure: each action is a ready store command or a reason it can't run. Read replicas and shards
 * are found through the registry's scaling roles (`.meta({ scaling: 'readReplicas' | 'shards' })`
 * on config fields), so new components get the actions with no UI change.
 */
import type { z } from 'zod';
import type { EntryByKind } from '@/registry';
import type { BoardCommand, NodeInstance } from '@/store';
import { readableIssue } from '../form/validate';

type ComponentDefinition = EntryByKind['component'];

export type ScaleActionId = 'replica' | 'size-up' | 'size-down' | 'read-replica' | 'shard';

export interface ScaleAction {
  id: ScaleActionId;
  label: string;
  /** What the click does, e.g. "Replicas 2 → 3". */
  description: string;
  command?: BoardCommand;
  /** Why the action is unavailable (then `command` is undefined). */
  disabledReason?: string;
}

type InstanceType = ComponentDefinition['instanceTypes'][number];

/** Instance family = id without its size suffix ("mem-large" → "mem", "small" → ""). */
export function instanceFamily(id: string): string {
  const i = id.lastIndexOf('-');
  return i > 0 ? id.slice(0, i) : '';
}

/** Sizes of the same family as `currentId`, smallest first (vCPU, then memory, then price). */
export function familySizes(def: ComponentDefinition, currentId: string): InstanceType[] {
  const fam = instanceFamily(currentId);
  return def.instanceTypes
    .filter((t) => instanceFamily(t.id) === fam)
    .slice()
    .sort((a, b) => a.vCpu - b.vCpu || a.memGb - b.memGb || a.costUsdPerHour - b.costUsdPerHour);
}

type Meta = { meta?: () => Record<string, unknown> | undefined; def?: { innerType?: unknown } };

/** Config key tagged with a scaling role, looking through optional/default wrappers. */
export function roleField(def: ComponentDefinition, role: string): string | undefined {
  for (const [key, field] of Object.entries(def.configSchema.shape)) {
    let cur = field as Meta | undefined;
    for (let i = 0; cur && i < 8; i++) {
      if (cur.meta?.()?.scaling === role) return key;
      cur = cur.def?.innerType as Meta | undefined;
    }
  }
  return undefined;
}

function configNumber(def: ComponentDefinition, node: NodeInstance, key: string): number {
  const v = node.config[key] ?? def.defaults[key];
  return typeof v === 'number' ? v : 0;
}

/** First validation message for one config field value, or undefined if valid. */
function fieldIssue(def: ComponentDefinition, key: string, value: number): string | undefined {
  const field = def.configSchema.shape[key] as z.ZodType | undefined;
  const res = field?.safeParse(value);
  const first = res && !res.success ? res.error.issues[0] : undefined;
  return first ? readableIssue(first) : undefined;
}

const spec = (t: InstanceType) =>
  `${t.id} (${t.vCpu} vCPU · ${t.memGb} GB · $${t.costUsdPerHour}/h)`;

export function scaleActions(def: ComponentDefinition, node: NodeInstance): ScaleAction[] {
  if (def.category === 'clients') return [];
  const actions: ScaleAction[] = [];
  const { replicas, instanceType, autoscale } = node.scaling;

  actions.push(
    autoscale
      ? {
          id: 'replica',
          label: '+1 replica',
          description: `Replicas ${replicas} → ${replicas + 1}`,
          disabledReason: `Autoscaling sets the replica count (${autoscale.min}–${autoscale.max}); change its min/max instead.`,
        }
      : {
          id: 'replica',
          label: '+1 replica',
          description: `Replicas ${replicas} → ${replicas + 1}`,
          command: { type: 'updateNode', nodeId: node.id, scaling: { replicas: replicas + 1 } },
        },
  );

  const sizes = familySizes(def, instanceType);
  const at = sizes.findIndex((t) => t.id === instanceType);
  const step = (dir: 1 | -1): ScaleAction => {
    const id = dir === 1 ? 'size-up' : 'size-down';
    const label = dir === 1 ? 'Size up' : 'Size down';
    const next = at >= 0 ? sizes[at + dir] : undefined;
    if (!next) {
      return {
        id,
        label,
        description: label,
        disabledReason:
          at < 0
            ? `Unknown instance type "${instanceType}".`
            : sizes.length <= 1
              ? `${def.name} comes in one size.`
              : dir === 1
                ? `${instanceType} is the largest size in its family.`
                : `${instanceType} is the smallest size in its family.`,
      };
    }
    return {
      id,
      label,
      description: `Instance ${instanceType} → ${spec(next)}`,
      command: { type: 'updateNode', nodeId: node.id, scaling: { instanceType: next.id } },
    };
  };
  actions.push(step(1), step(-1));

  const rr = roleField(def, 'readReplicas');
  if (rr === undefined) {
    actions.push({
      id: 'read-replica',
      label: 'Add read replica',
      description: 'Add read replica',
      disabledReason: `${def.name} has no read replicas (only single-primary stores do). Use +1 replica or shard ×2.`,
    });
  } else {
    const cur = configNumber(def, node, rr);
    const issue = fieldIssue(def, rr, cur + 1);
    actions.push({
      id: 'read-replica',
      label: 'Add read replica',
      description: `Read replicas ${cur} → ${cur + 1} (reads only; writes stay on the primary)`,
      ...(issue
        ? { disabledReason: `Can't add another read replica: ${issue}.` }
        : { command: { type: 'updateConfig', nodeId: node.id, config: { [rr]: cur + 1 } } }),
    });
  }

  const sh = roleField(def, 'shards');
  if (sh === undefined) {
    actions.push({
      id: 'shard',
      label: 'Shard ×2',
      description: 'Shard ×2',
      disabledReason: `${def.name} is not sharded. Scale it with replicas or a bigger instance.`,
    });
  } else {
    const cur = Math.max(1, configNumber(def, node, sh));
    const issue = fieldIssue(def, sh, cur * 2);
    actions.push({
      id: 'shard',
      label: 'Shard ×2',
      description: `Shards ${cur} → ${cur * 2} (splits reads and writes by key)`,
      ...(issue
        ? { disabledReason: `Can't double the shards: ${issue}.` }
        : { command: { type: 'updateConfig', nodeId: node.id, config: { [sh]: cur * 2 } } }),
    });
  }
  return actions;
}
