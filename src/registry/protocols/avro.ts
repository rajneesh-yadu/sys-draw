import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'avro',
  name: 'Apache Avro',
  osiLayer: 6,
  handshakeRtts: 0,
  perMessageOverheadBytes: 5, // Confluent wire format: magic byte + 4 B schema id
  payloadSizeFactor: 0.45, // no field tags at all: the schema says what comes next
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: [],
  pattern: 'encoding',
  conceptual: true,
  docs: {
    summary:
      'Binary encoding whose schema travels separately (schema registry), so records carry no field names or tags. Popular for Kafka events because schemas can evolve with compatibility checks.',
    handshakeSteps: ['None: producers and consumers fetch schemas from a schema registry by id'],
    headerFields: ['Magic byte + schema id (registry wire format)', 'Fields in schema order'],
    securityNotes: [
      'Protect the schema registry: whoever can change a schema can break every consumer.',
      'Enforce backward/forward compatibility rules so a deploy cannot publish unreadable events.',
    ],
  },
});
