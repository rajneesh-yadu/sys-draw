/** S18 lesson: consistent hashing (Learn mode). */
import { defineLesson } from '../define';
import { design, STACK } from '../problems/kit';

const board = design()
  .node('client', 'client.app', 'Users', [0, 1], { type: 'browser' })
  .node('lb', 'network.load-balancer', 'Load balancer (consistent hash)', [1, 1], {
    type: 'standard',
    config: { algorithm: 'consistent-hash' },
  })
  .node('a', 'compute.app-server', 'Server A', [2, 0], { type: 'medium' })
  .node('b', 'compute.app-server', 'Server B', [2, 1], { type: 'medium' })
  .node('c', 'compute.app-server', 'Server C', [2, 2], { type: 'medium' })
  .edge('client', 'lb', STACK.https)
  .edge('lb', 'a', STACK.internal)
  .edge('lb', 'b', STACK.internal)
  .edge('lb', 'c', STACK.internal)
  .build();

export default defineLesson({
  id: 'lesson.consistent-hashing',
  title: 'Consistent hashing',
  level: 2,
  tags: ['partitioning', 'load-balancing', 'caching'],
  related: ['network.load-balancer', 'cache.redis', 'database.cassandra'],
  steps: [
    {
      title: 'The problem with hash mod N',
      body: 'Sending key k to server hash(k) mod N spreads keys evenly, but adding or removing one server changes N, so almost every key moves (about N/(N+1) of them). For a cache that means a sudden wave of misses; for a database, a huge reshuffle.',
      focusIds: ['node_lb'],
    },
    {
      title: 'Put servers on a ring',
      body: 'Hash every server onto a circle (0 … 2³²). A key is hashed onto the same circle and goes to the first server clockwise. Adding a server only takes over the keys between it and its predecessor: about 1/N of the keys move instead of nearly all.',
      focusIds: ['node_a', 'node_b', 'node_c'],
    },
    {
      title: 'Virtual nodes even out the load',
      body: 'With only three points on the ring, arcs have very different lengths, so one server may own 50 % of the keys. Placing each server at 100–200 virtual points makes every server own close to 1/N. Cassandra, DynamoDB and Redis Cluster–style sharding all use this idea.',
      focusIds: ['edge_lb-a', 'edge_lb-b', 'edge_lb-c'],
    },
    {
      title: 'Try it',
      body: 'Load the mini-board, simulate it, then delete Server C: only the keys C owned move to its neighbour. Switch the load balancer to round-robin and compare: with no affinity, every server sees every key, so per-server caches hit less often.',
      focusIds: ['node_c'],
    },
  ],
  quiz: [
    {
      question:
        'A cluster of 4 cache servers uses hash(k) mod 4. You add a fifth. Roughly what share of keys move?',
      options: ['About 20 %', 'About 80 %', 'None', 'Exactly 25 %'],
      answerIndex: 1,
      explanation:
        'With mod N almost every key changes server (N/(N+1) = 4/5). On a consistent-hash ring only ≈ 1/5 would move.',
    },
    {
      question: 'Why use virtual nodes?',
      options: [
        'To encrypt keys on the ring',
        'To make each server own a fair share of the ring',
        'To store more replicas of each key',
        'To avoid hashing keys at all',
      ],
      answerIndex: 1,
      explanation:
        'Many points per server average out the arc lengths, so load is close to 1/N per server.',
    },
    {
      question: 'Server B leaves the ring. Whose keys does it affect?',
      options: [
        'Every server',
        'Only B’s keys, which move to the next server clockwise',
        'Only keys on A',
        'No keys',
      ],
      answerIndex: 1,
      explanation: 'Only the arc B owned is reassigned, to its clockwise successor.',
    },
  ],
  board,
  docs: {
    summary:
      'Why hash mod N reshuffles everything when a server joins, and how a hash ring with virtual nodes moves only 1/N of the keys.',
  },
});
