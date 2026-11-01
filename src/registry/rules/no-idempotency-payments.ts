/**
 * S19 design review: a payment-like service (label matches pay / checkout / billing / charge /
 * ledger / wallet) with no idempotency-key store, so a retried or redelivered request can charge
 * twice. Satisfied by a node it calls whose label mentions idempotency or dedup. Fix: add an
 * "Idempotency keys" key-value store and connect the service to it.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, isComputeDef, nodeMap, outgoing } from '../design-tools';

const ID = 'rule.no-idempotency-payments';
const PAYMENT = /pay|checkout|billing|charge|ledger|wallet|stripe/i;
const IDEMPOTENCY = /idempot|dedup/i;

export default defineRule({
  id: ID,
  title: 'Payments without idempotency',
  category: 'reliability',
  severity: 'error',
  tags: ['idempotency', 'payments', 'exactly-once', 'retries'],
  appliesTo: { categories: ['compute'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      if (!isComputeDef(defOf(ctx, n)) || !PAYMENT.test(n.label)) continue;
      const guarded = outgoing(ctx.graph, n.id).some((e) =>
        IDEMPOTENCY.test(byId.get(e.target)?.label ?? ''),
      );
      if (guarded) continue;
      out.push({
        ruleId: ID,
        severity: 'error',
        title: `"${n.label}" can charge twice`,
        message: `Clients retry on timeouts, load balancers retry on resets and queues redeliver at least once. Without an idempotency key checked by "${n.label}", the second copy of a request is processed as a new payment.`,
        targetIds: [n.id],
        fix: 'Require an Idempotency-Key header; store key → result in a durable store with a unique constraint, and return the stored result for repeats.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const n = ctx.graph.nodes.find((x) => x.id === finding.targetIds[0]);
    const store = ctx.components.get('database.kv-store') ?? ctx.components.get('cache.redis');
    if (!n || !store) return undefined;
    return {
      label: `Add an idempotency-key store for ${n.label}`,
      steps: [
        {
          kind: 'addNode',
          defId: store.id,
          label: 'Idempotency keys',
          near: n.id,
          connectFrom: [n.id],
        },
      ],
    };
  },
  docs: {
    summary: 'Flags payment services that have no store of idempotency keys.',
    why: 'Networks only give at-least-once delivery: a timeout does not tell the client whether the charge happened, so it retries. Exactly-once effects need deduplication at the receiver.',
    howToFix:
      'Have the client generate a unique key per payment intent, insert it with a unique constraint before charging, and return the saved response when the same key arrives again (Stripe-style Idempotency-Key). Keep keys at least as long as clients may retry.',
  },
});
