import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'dns',
  name: 'DNS',
  osiLayer: 7,
  handshakeRtts: 0,
  perMessageOverheadBytes: 40, // 12 B header + question section
  multiplexing: false,
  reliable: false,
  ordered: false,
  encrypted: false,
  runsOn: ['udp', 'tcp', 'tls13'],
  pattern: 'request-response',
  ports: { plain: [53], secure: [853] },
  suggestedStacks: [
    {
      from: [],
      to: ['network.dns'],
      stack: ['udp', 'dns'],
      why: 'Lookups are one small datagram each way over UDP 53; TCP is only used for large answers and zone transfers.',
    },
  ],
  docs: {
    summary:
      'Turns names into addresses. A lookup is one small question and answer, usually over UDP; resolvers cache answers for their TTL, which is also how long a failover takes to reach clients.',
    handshakeSteps: [
      'Stub resolver → recursive resolver: query (1 RTT if cached there)',
      'On a miss the resolver walks root → TLD → authoritative servers',
      'Over TCP or TLS (DoT, 853) the usual handshakes come first',
    ],
    headerFields: [
      'Transaction id, flags (RD, RA, AA, TC)',
      'Question: name, type (A, AAAA, CNAME, HTTPS)',
      'Answers with TTL',
    ],
    securityNotes: [
      'Plain DNS is unauthenticated and visible; DNSSEC signs answers, DoT/DoH encrypt the lookup.',
      'Open resolvers are abused for amplification DDoS.',
      'Long TTLs slow down failover; very short TTLs increase resolver load.',
    ],
  },
});
