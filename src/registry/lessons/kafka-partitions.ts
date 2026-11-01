/** S18 lesson: Kafka partitions, ordering and consumer groups (Learn mode). */
import { defineLesson } from '../define';
import { design, STACK } from '../problems/kit';

const board = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .node('client', 'client.app', 'Apps', [0, 1], { type: 'browser' })
  .node('producer', 'compute.app-server', 'Order API (producer)', [1, 1], {
    type: 'medium',
    replicas: 2,
    group: 'use1',
  })
  .node('stream', 'messaging.stream', 'orders topic (Kafka)', [2, 1], {
    type: 'large',
    replicas: 3,
    group: 'use1',
    config: { partitions: 12 },
  })
  .node('consumer', 'compute.app-server', 'Billing consumers', [3, 1], {
    type: 'medium',
    replicas: 4,
    group: 'use1',
  })
  .edge('client', 'producer', STACK.https)
  .edge('producer', 'stream', STACK.kafka)
  .edge('stream', 'consumer', STACK.internal, { async: true })
  .build();

export default defineLesson({
  id: 'lesson.kafka-partitions',
  title: 'Kafka partitions and consumer groups',
  level: 3,
  tags: ['messaging', 'streaming', 'partitioning', 'ordering'],
  related: ['messaging.kafka', 'messaging.stream', 'kafka-wire'],
  steps: [
    {
      title: 'A topic is a set of logs',
      body: 'A Kafka topic is split into partitions; each partition is an append-only log stored on a leader broker and copied to followers. Producers append, consumers read at their own offset, and messages stay for the retention period whether or not they were read.',
      focusIds: ['node_stream'],
    },
    {
      title: 'Keys decide the partition',
      body: 'A message’s key is hashed to pick its partition, so every event for order 42 lands in the same partition. Kafka only orders messages within a partition: choose the key that must stay in order (order id, user id), and beware of hot keys that overload one partition.',
      focusIds: ['edge_producer-stream'],
    },
    {
      title: 'Consumer groups scale reads',
      body: 'Consumers in one group share the partitions: each partition is read by exactly one consumer of the group. With 12 partitions, up to 12 consumers work in parallel; a 13th sits idle. So the partition count caps your consumer parallelism — pick it with growth in mind.',
      focusIds: ['node_consumer', 'edge_stream-consumer'],
    },
    {
      title: 'Try it',
      body: 'Load the mini-board and simulate. Raise the billing consumers past 12 replicas: throughput stops growing because there are only 12 partitions. Raise the partitions and the extra consumers get work.',
    },
  ],
  quiz: [
    {
      question:
        'A topic has 6 partitions and a consumer group has 10 consumers. How many consumers receive messages?',
      options: ['10', '6', '1', '60'],
      answerIndex: 1,
      explanation:
        'Each partition goes to one consumer of the group, so at most 6 are busy and 4 are idle.',
    },
    {
      question: 'You need every event of one order processed in order. What key do you use?',
      options: ['A random UUID', 'The order id', 'The timestamp', 'No key (round-robin)'],
      answerIndex: 1,
      explanation:
        'Same key → same partition → ordered. Random or no keys spread one order over many partitions.',
    },
    {
      question: 'What happens to a message after a consumer reads it?',
      options: [
        'It is deleted immediately',
        'It stays until the retention period ends; the consumer just advances its offset',
        'It moves to another partition',
        'It is sent back to the producer',
      ],
      answerIndex: 1,
      explanation:
        'Kafka is a log: reading does not remove data, so other groups (or a replay) can read it again.',
    },
  ],
  board,
  docs: {
    summary:
      'How Kafka partitions order messages per key, why consumer groups can use at most one consumer per partition, and how to choose keys and partition counts.',
  },
});
