/**
 * S19 design review: messages are published to a queue/topic/log that nothing consumes, so they
 * pile up until retention drops them. Fix: add a worker that consumes it.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, incoming, isMessagingDef, outgoing } from '../design-tools';

const ID = 'rule.queue-without-consumer';

export default defineRule({
  id: ID,
  title: 'Queue without a consumer',
  category: 'reliability',
  severity: 'error',
  tags: ['queue', 'consumer', 'backlog', 'messaging'],
  appliesTo: { categories: ['messaging'] },
  check: (ctx) => {
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      if (!isMessagingDef(defOf(ctx, n))) continue;
      if (incoming(ctx.graph, n.id).length === 0 || outgoing(ctx.graph, n.id).length > 0) continue;
      out.push({
        ruleId: ID,
        severity: 'error',
        title: `Nothing consumes "${n.label}"`,
        message: `Producers publish to "${n.label}" but no service reads from it. The backlog grows forever, and messages expire when the retention period ends: the work they represent never happens.`,
        targetIds: [n.id],
        fix: 'Connect a consumer (worker service or function) and size it for the publish rate.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const n = ctx.graph.nodes.find((x) => x.id === finding.targetIds[0]);
    const worker = ctx.components.get('compute.app-server');
    if (!n || !worker) return undefined;
    return {
      label: `Add a worker consuming ${n.label}`,
      steps: [
        { kind: 'addNode', defId: worker.id, label: 'Worker', near: n.id, connectFrom: [n.id] },
      ],
    };
  },
  docs: {
    summary: 'Flags queues, topics and logs that receive messages but have no consumer.',
    why: 'A queue only decouples producer and consumer; it does not do the work. Without consumers, lag grows without bound and messages are lost at the end of retention.',
    howToFix:
      'Attach a consumer group or worker pool, scale it on queue depth / age of oldest message, and add a dead-letter queue for messages that keep failing.',
  },
});
