import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'icmp',
  name: 'ICMP',
  osiLayer: 3,
  handshakeRtts: 0,
  perMessageOverheadBytes: 8,
  multiplexing: false,
  reliable: false,
  ordered: false,
  encrypted: false,
  runsOn: [],
  pattern: 'routing',
  conceptual: true,
  docs: {
    summary:
      'Control messages of the IP layer: ping (echo), "destination unreachable", "time exceeded" (used by traceroute) and "packet too big" (path-MTU discovery).',
    handshakeSteps: ['None'],
    headerFields: [
      'Type and code (e.g. 3/4 = fragmentation needed)',
      'Checksum',
      'Original IP header for errors',
    ],
    securityNotes: [
      'Blocking all ICMP breaks path-MTU discovery and causes mysterious hangs on large responses.',
      'Rate-limit echo replies; ICMP floods and network mapping use them.',
    ],
  },
});
