import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'protobuf',
  name: 'Protocol Buffers',
  osiLayer: 6,
  handshakeRtts: 0,
  perMessageOverheadBytes: 0,
  payloadSizeFactor: 0.5, // rough: often 2–3× smaller than JSON for the same record
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: [],
  pattern: 'encoding',
  conceptual: true,
  docs: {
    summary:
      'Compact binary encoding with a schema (.proto). Fields are numbered tags instead of names, so messages are smaller and faster to parse than JSON; gRPC uses it by default.',
    handshakeSteps: ['None: an encoding, not a connection protocol'],
    headerFields: ['Field number + wire type per field (varint tag)', 'Varint-encoded integers'],
    securityNotes: [
      'Not human-readable, but not encrypted either — anyone can decode it without the schema.',
      'Never reuse a field number for a different meaning; old clients will misread it.',
    ],
  },
});
