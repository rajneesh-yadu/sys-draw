import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'ipv6',
  name: 'IPv6',
  osiLayer: 3,
  handshakeRtts: 0,
  perMessageOverheadBytes: 40,
  multiplexing: false,
  reliable: false,
  ordered: false,
  encrypted: false,
  runsOn: [],
  pattern: 'routing',
  conceptual: true,
  docs: {
    summary:
      'IP with 128-bit addresses, so every device can have a global address without NAT. Its fixed header is 40 B (IPv4: 20 B); most mobile networks are IPv6-first today.',
    handshakeSteps: ['None: each packet is routed on its own'],
    headerFields: [
      'Source / destination address (128 bit)',
      'Hop limit',
      'Next header',
      'Flow label',
    ],
    securityNotes: [
      'No NAT does not mean no firewall: security groups must cover IPv6 ranges too (a common gap).',
      'Dual-stack hosts can be reachable over IPv6 even when IPv4 rules look locked down.',
    ],
  },
});
