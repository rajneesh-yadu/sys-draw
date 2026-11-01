import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'resp',
  name: 'Redis RESP',
  osiLayer: 7,
  handshakeRtts: 1, // HELLO / AUTH on a new connection (managed Redis requires auth)
  resumedHandshakeRtts: 1,
  perMessageOverheadBytes: 14, // *N\r\n$len\r\n framing for a small command + reply
  multiplexing: false, // one connection serves requests in order (pipelining, not multiplexing)
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12'],
  pattern: 'request-response',
  ports: { plain: [6379], secure: [6380] },
  handshakeSequence: [
    { from: 'client', message: 'HELLO 3 AUTH user pass' },
    { from: 'server', message: 'Server info map', detail: 'protocol version, role, modules' },
  ],
  docs: {
    summary:
      'Redis serialisation protocol: simple text-framed commands and typed replies. Very cheap per command; clients pipeline many commands on one connection to save round trips.',
    handshakeSteps: [
      'HELLO (protocol 3) with AUTH, or AUTH alone',
      'Optional SELECT db / CLIENT SETNAME',
      'Cluster clients also fetch CLUSTER SLOTS to learn which node owns each key',
    ],
    headerFields: [
      'Arrays (*3), bulk strings ($5), integers (:1), errors (-ERR)',
      'RESP3 adds maps, sets and push messages (client-side caching)',
    ],
    securityNotes: [
      'Never expose Redis to the internet; unauthenticated instances are found and abused within minutes.',
      'Enable TLS for cross-AZ or cross-VPC traffic; AUTH passwords travel in clear otherwise.',
      'Rename or ACL-block dangerous commands (FLUSHALL, CONFIG, KEYS).',
    ],
  },
});
