import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'json',
  name: 'JSON',
  osiLayer: 6,
  handshakeRtts: 0,
  perMessageOverheadBytes: 0,
  payloadSizeFactor: 1, // the reference size for scenario payloads
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: [],
  pattern: 'encoding',
  conceptual: true,
  docs: {
    summary:
      'Human-readable text encoding used by most web APIs. Self-describing (field names in every message), so it is easy to debug but larger and slower to parse than binary formats.',
    handshakeSteps: ['None: an encoding, not a connection protocol'],
    headerFields: ['Content-Type: application/json', 'Field names repeated in every object'],
    securityNotes: [
      'Validate input against a schema; mass assignment and type confusion bugs come from trusting JSON shapes.',
      'Very deep or huge documents can exhaust parser memory — cap request size.',
    ],
  },
});
