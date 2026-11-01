/**
 * S19 design review: the database connections the callers can open (instances × pool size, at
 * the autoscaling maximum) exceed what the database accepts. Postgres without pooling is capped at
 * its default max_connections of 100. Fix (Postgres): turn on connection pooling (PgBouncer).
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import {
  defOf,
  incoming,
  isComputeDef,
  isDatabaseDef,
  maxInstances,
  nodeMap,
  numberAt,
} from '../design-tools';

const ID = 'rule.db-connections-exceed-limit';
/** Postgres' default max_connections. */
export const POSTGRES_DEFAULT_MAX_CONNECTIONS = 100;
/** Pool size assumed per instance when neither the edge nor the service sets one. */
export const DEFAULT_POOL_SIZE = 10;

export default defineRule({
  id: ID,
  title: 'Database connections exceed the limit',
  category: 'scalability',
  severity: 'error',
  tags: ['connection-pool', 'max-connections', 'database', 'pgbouncer'],
  appliesTo: { categories: ['database'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const db of ctx.graph.nodes) {
      if (!isDatabaseDef(defOf(ctx, db))) continue;
      const limit =
        numberAt(db.config, 'maxConnections') ??
        (db.config.connectionPooling === false ? POSTGRES_DEFAULT_MAX_CONNECTIONS : undefined);
      if (limit === undefined) continue;
      const parts: { label: string; conns: number; edgeId: string }[] = [];
      for (const e of incoming(ctx.graph, db.id)) {
        const caller = byId.get(e.source);
        if (!caller || !isComputeDef(defOf(ctx, caller))) continue;
        const pool =
          e.config.poolSize ?? numberAt(caller.config, 'dbPoolSize') ?? DEFAULT_POOL_SIZE;
        parts.push({
          label: `${caller.label} ${maxInstances(caller)} × ${pool}`,
          conns: maxInstances(caller) * pool,
          edgeId: e.id,
        });
      }
      const total = parts.reduce((a, p) => a + p.conns, 0);
      if (total <= limit) continue;
      out.push({
        ruleId: ID,
        severity: 'error',
        title: `${total.toLocaleString('en-US')} connections into "${db.label}" (limit ${limit.toLocaleString('en-US')})`,
        message: `At full scale the callers open ${parts.map((p) => p.label).join(' + ')} = ${total.toLocaleString('en-US')} connections, but "${db.label}" accepts ${limit.toLocaleString('en-US')}. New instances fail to connect exactly when traffic peaks (scale-out makes it worse).`,
        targetIds: [db.id, ...parts.map((p) => p.edgeId)],
        fix: 'Put a connection pooler (PgBouncer, RDS Proxy) in front of the database, shrink per-instance pools, or cap the autoscaling maximum.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const db = ctx.graph.nodes.find((n) => n.id === finding.targetIds[0]);
    if (!db || db.config.connectionPooling !== false) return undefined;
    return {
      label: `Turn on connection pooling for ${db.label}`,
      steps: [{ kind: 'setNodeConfig', nodeId: db.id, config: { connectionPooling: true } }],
    };
  },
  docs: {
    summary: 'Flags databases whose callers can open more connections than the database allows.',
    why: 'Every app instance keeps its own pool. 50 instances × 20 connections = 1 000, while Postgres defaults to 100 and each connection costs memory (a process per connection in Postgres). Past the limit, connects fail.',
    howToFix:
      'Multiplex many client connections over few server connections with a pooler (PgBouncer in transaction mode, RDS Proxy), size pools as (limit − headroom) ÷ max instances, and cap autoscaling accordingly.',
  },
});
