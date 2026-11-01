/** S18 lesson: the CAP theorem and tunable consistency (Learn mode). */
import { defineLesson } from '../define';
import { design, STACK } from '../problems/kit';

const board = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('euw1', 'region', 'EU West', { regionId: 'eu-west' })
  .node('client', 'client.app', 'Users', [0, 1], { type: 'browser' })
  .node('api', 'compute.app-server', 'API (US)', [1, 0], {
    type: 'medium',
    replicas: 2,
    group: 'use1',
  })
  .node('db', 'database.cassandra', 'Cassandra (RF 3)', [2, 1], {
    type: 'xlarge',
    replicas: 3,
    group: 'use1',
    config: { replicationFactor: 3, readConsistency: 'QUORUM', writeConsistency: 'QUORUM' },
  })
  .edge('client', 'api', STACK.https)
  .edge('api', 'db', STACK.cql)
  .build();

export default defineLesson({
  id: 'lesson.cap-theorem',
  title: 'CAP: consistency vs availability',
  level: 3,
  tags: ['consistency', 'replication', 'distributed-systems'],
  related: ['database.cassandra', 'database.postgres', 'database.spanner'],
  steps: [
    {
      title: 'Partitions happen',
      body: 'A network partition splits replicas that cannot talk to each other. CAP says that during a partition a replicated store must choose: answer anyway (Available, maybe stale) or refuse until it can be sure (Consistent). Without a partition you can have both.',
    },
    {
      title: 'CP and AP systems',
      body: 'A single-leader SQL database or Spanner refuses writes on the minority side (CP). Cassandra and DynamoDB keep accepting reads and writes on both sides and reconcile later (AP). Neither is “better”: a bank ledger wants CP, a like counter is happy with AP.',
      focusIds: ['node_db'],
    },
    {
      title: 'Quorums tune the trade-off',
      body: 'With N replicas, a write waits for W acknowledgements and a read asks R replicas. If R + W > N every read overlaps the latest write (strongly consistent while a quorum is reachable). ONE/ONE is fast and available but may read stale data; QUORUM/QUORUM (2 + 2 > 3) is consistent and survives one replica down.',
      focusIds: ['node_db', 'edge_api-db'],
    },
    {
      title: 'Try it',
      body: 'Load the mini-board and simulate. Set read and write consistency to ONE: p99 drops, but R + W = 2 ≤ 3, so reads can be stale. Set both to ALL: every request waits for the slowest replica, and one replica outage fails requests.',
    },
  ],
  quiz: [
    {
      question:
        'N = 3 replicas. Which setting guarantees a read sees the latest acknowledged write?',
      options: ['R = 1, W = 1', 'R = 2, W = 2', 'R = 1, W = 2', 'R = 2, W = 1'],
      answerIndex: 1,
      explanation:
        'R + W = 4 > N = 3, so the read and write sets always share at least one replica.',
    },
    {
      question: 'During a partition an AP store…',
      options: [
        'rejects all requests',
        'keeps answering, possibly with stale data',
        'loses every write',
        'becomes strongly consistent',
      ],
      answerIndex: 1,
      explanation:
        'Availability first: both sides serve requests and conflicts are reconciled later.',
    },
    {
      question: 'Which workload most needs a CP choice?',
      options: [
        'View counters',
        'A product catalogue cache',
        'An account balance ledger',
        'Presence (“online now”)',
      ],
      answerIndex: 2,
      explanation:
        'Money must never be double-spent, so refusing a write is better than accepting a conflicting one.',
    },
  ],
  board,
  docs: {
    summary:
      'What CAP really says about network partitions, CP vs AP databases, and how R + W > N quorums tune consistency against latency.',
  },
});
