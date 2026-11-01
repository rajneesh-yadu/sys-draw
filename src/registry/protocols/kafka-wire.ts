import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'kafka-wire',
  name: 'Kafka wire protocol',
  osiLayer: 7,
  handshakeRtts: 2, // ApiVersions, then Metadata (SASL authentication adds more)
  resumedHandshakeRtts: 2,
  perMessageOverheadBytes: 70, // request header + record batch header (61 B) amortised
  multiplexing: true, // pipelined requests with correlation ids
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12', 'mtls'],
  pattern: 'stream',
  ports: { plain: [9092], secure: [9093] },
  handshakeSequence: [
    { from: 'client', message: 'ApiVersions request' },
    { from: 'server', message: 'ApiVersions response', detail: 'supported request versions' },
    { from: 'client', message: 'Metadata request', detail: 'topics' },
    { from: 'server', message: 'Metadata response', detail: 'brokers and partition leaders' },
  ],
  suggestedStacks: [
    {
      from: ['category:compute'],
      to: ['messaging.kafka', 'messaging.stream'],
      stack: ['tcp', 'kafka-wire'],
      why: "Services talk to Kafka brokers with Kafka's own binary protocol over long-lived TCP connections (PLAINTEXT 9092 inside the VPC; add TLS/SASL on 9093 when traffic crosses trust boundaries).",
    },
  ],
  docs: {
    summary:
      "Kafka's binary request/response protocol over TCP. Producers send record batches straight to each partition's leader broker; consumers fetch from an offset. Clients keep connections open and pipeline requests.",
    handshakeSteps: [
      'ApiVersions (version negotiation)',
      'Optional SASL handshake + authenticate',
      'Metadata: which broker leads each partition',
      'Then Produce / Fetch requests to the leaders',
    ],
    headerFields: [
      'Size, API key, API version, correlation id, client id',
      'Record batch: base offset, producer id/epoch (idempotence), compression codec, records',
    ],
    securityNotes: [
      'PLAINTEXT listeners expose every event; use TLS + SASL (or mTLS) across trust boundaries.',
      'Topic ACLs: a producer that can write any topic can poison downstream consumers.',
      'Brokers advertise their addresses — misconfigured advertised.listeners leak internal hostnames.',
    ],
  },
});
