/** S18 lesson: cache-aside caching, hit rates and stampedes (Learn mode). */
import { defineLesson } from '../define';
import { design, STACK } from '../problems/kit';

const board = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .node('client', 'client.app', 'Users', [0, 1], { type: 'browser' })
  .node('api', 'compute.app-server', 'Product API', [1, 1], {
    type: 'medium',
    replicas: 3,
    group: 'use1',
  })
  .node('cache', 'cache.redis', 'Product cache (Redis)', [2, 0], {
    type: 'mem-large',
    group: 'use1',
    config: { keyCount: 1_000_000, avgItemBytes: 2_000, ttlSec: 600 },
  })
  .node('db', 'database.postgres', 'Products (Postgres)', [2, 2], {
    type: 'large',
    group: 'use1',
  })
  .edge('client', 'api', STACK.https)
  .edge('api', 'cache', STACK.redis)
  .edge('api', 'db', STACK.postgres)
  .build();

export default defineLesson({
  id: 'lesson.cache-aside',
  title: 'Caching: cache-aside, hit rate, stampedes',
  level: 1,
  tags: ['caching', 'performance', 'read-heavy'],
  related: ['cache.redis', 'cache.memcached', 'database.postgres'],
  steps: [
    {
      title: 'Cache-aside',
      body: 'The service first asks the cache. On a hit it returns at once (~1 ms); on a miss it reads the database, stores the value in the cache with a TTL, and returns. Writes update the database and delete (or update) the cached key.',
      focusIds: ['node_api', 'node_cache', 'node_db'],
    },
    {
      title: 'Hit rate is everything',
      body: 'Mean latency ≈ hit × cache time + (1 − hit) × (cache + DB time), and DB load = (1 − hit) × reads. Going from a 90 % to a 99 % hit rate cuts database reads by 10×. Popularity is usually skewed (Zipf), so a cache holding a small fraction of the keys can still hit most requests.',
      focusIds: ['edge_api-cache'],
    },
    {
      title: 'TTL and stampedes',
      body: 'A TTL bounds how stale data can be. When a hot key expires, thousands of requests can miss at once and all hit the database — a cache stampede (thundering herd). Fixes: let one request refresh while others wait (request coalescing / locks), refresh early with jitter, or never expire hot keys.',
      focusIds: ['node_db'],
    },
    {
      title: 'Try it',
      body: 'Load the mini-board and simulate. Shrink the cache to a small memory size and watch the hit rate fall and the database’s utilisation climb. Then lower the TTL to 10 seconds and compare.',
      focusIds: ['node_cache'],
    },
  ],
  quiz: [
    {
      question:
        'Reads are 10,000/s. Raising the hit rate from 90 % to 99 % changes database reads from…',
      options: ['1,000/s to 100/s', '9,000/s to 9,900/s', '10,000/s to 1,000/s', 'Nothing changes'],
      answerIndex: 0,
      explanation: 'DB reads = (1 − hit) × reads: 10 % → 1 % of 10,000/s.',
    },
    {
      question: 'In cache-aside, who loads a missing key into the cache?',
      options: [
        'The database',
        'The cache itself',
        'The application after reading the DB',
        'The client',
      ],
      answerIndex: 2,
      explanation: 'The application owns the logic: read DB on a miss, then populate the cache.',
    },
    {
      question: 'Which technique prevents a cache stampede?',
      options: [
        'Shorter TTLs',
        'Request coalescing (one refresh, others wait)',
        'More database indexes',
        'Disabling the cache',
      ],
      answerIndex: 1,
      explanation:
        'Only one request rebuilds the hot key; the others wait for it or serve the stale value.',
    },
  ],
  board,
  docs: {
    summary:
      'Cache-aside reads and writes, why hit rate drives database load, and how TTLs cause stampedes and how to prevent them.',
  },
});
