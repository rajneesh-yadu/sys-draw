/**
 * podPacking: a workload on a Kubernetes cluster. The node's instances are WORKER NODES; pods
 * are bin-packed onto them by their resource requests:
 *   pods per node = min(⌊(vCPU − reserved) / cpuRequest⌋, ⌊(mem − reserved) / memRequest⌋, maxPods)
 *   servers per node (M/M/c's c) = pods per node × concurrency per pod
 * A pod's speed is set by its CPU request, not the node size, so a bigger node fits more pods
 * instead of making each request faster (no vertical speedup). Autoscaling the node count is the
 * cluster autoscaler; the control plane is a flat fee (not in the cost).
 */
import { fmt } from '../model/format';
import type { CompiledNode } from '../model/types';
import { num } from './lib/config';
import { defineBehavior } from './types';

export const RESERVED_VCPU = 0.5;
export const RESERVED_MEM_GB = 1;

export function podsPerNode(node: CompiledNode): number {
  const t = node.instanceType;
  if (!t) return 1;
  const cpu = Math.max(0.01, num(node, 'podCpuRequest') ?? 0.5);
  const mem = Math.max(0.01, num(node, 'podMemoryGb') ?? 1);
  const maxPods = Math.max(1, Math.round(num(node, 'maxPodsPerNode') ?? 110));
  return Math.max(
    0,
    Math.min(
      Math.floor((t.vCpu - RESERVED_VCPU) / cpu + 1e-9),
      Math.floor((t.memGb - RESERVED_MEM_GB) / mem + 1e-9),
      maxPods,
    ),
  );
}

export const behavior = defineBehavior({
  id: 'podPacking',
  tune(node) {
    const pods = podsPerNode(node);
    const per = Math.max(1, Math.round(num(node, 'concurrencyPerPod') ?? 1));
    return {
      serviceTimeMs: { ...node.baseServiceTimeMs },
      serversPerInstance: Math.max(1, pods * per),
      scale: {
        ...node.scale,
        speedup: 1,
        verticalExplain: `Worker size changes how many pods fit (${pods} per node), not how fast each pod runs.`,
      },
    };
  },
  finish({ node, stats }) {
    const pods = podsPerNode(node);
    const t = node.instanceType;
    stats.explain.pods =
      pods === 0
        ? `A pod requesting ${fmt(num(node, 'podCpuRequest') ?? 0.5)} vCPU / ${fmt(num(node, 'podMemoryGb') ?? 1)} GB does not fit on a ${t?.id ?? '?'} node after system reservations: pods stay Pending. Use bigger nodes or smaller requests.`
        : `${t?.id ?? '?'} nodes (${fmt(t?.vCpu ?? 0)} vCPU, ${fmt(t?.memGb ?? 0)} GB) minus ${RESERVED_VCPU} vCPU / ${RESERVED_MEM_GB} GB for the kubelet fit ${pods} pod(s) each ⇒ ` +
          `${stats.replicas} node(s) × ${pods} = ${stats.replicas * pods} pods, c = ${pods} × ${fmt(num(node, 'concurrencyPerPod') ?? 1)} concurrent requests per node.`;
  },
});
