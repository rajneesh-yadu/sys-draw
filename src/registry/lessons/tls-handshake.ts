/** S18 lesson: the TLS 1.3 handshake and what it costs (Learn mode). */
import { defineLesson } from '../define';
import { design, STACK } from '../problems/kit';

const board = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .node('client', 'client.app', 'Browser', [0, 1], { type: 'browser' })
  .node('api', 'compute.app-server', 'Web server', [1, 1], { type: 'medium', group: 'use1' })
  .edge('client', 'api', STACK.https)
  .build();

export default defineLesson({
  id: 'lesson.tls-handshake',
  title: 'The TLS handshake',
  level: 2,
  tags: ['security', 'networking', 'latency'],
  related: ['tcp', 'tls13', 'tls12', 'quic', 'http3'],
  steps: [
    {
      title: 'Why TLS',
      body: 'TLS gives a connection confidentiality (encryption), integrity (tampering is detected) and authentication (the server proves it owns the domain with a certificate). Without it, anyone on the path — café Wi-Fi, an ISP — can read and change the traffic.',
      focusIds: ['edge_client-api'],
    },
    {
      title: 'TCP first, then TLS',
      body: 'A new HTTPS connection first opens TCP (SYN, SYN-ACK, ACK: 1 round trip). TLS 1.3 then sends ClientHello with a key share; the server answers with ServerHello, its certificate and Finished: 1 more round trip. Only then does the HTTP request go out — 3 RTTs in total for the first byte of a cold request.',
      focusIds: ['edge_client-api'],
    },
    {
      title: 'TLS 1.2, resumption and QUIC',
      body: 'TLS 1.2 needs 2 round trips for the handshake. Resumed TLS 1.3 sessions can send data immediately (0-RTT, with replay caveats). HTTP/3 over QUIC folds the transport and TLS handshakes into one round trip.',
    },
    {
      title: 'Try it',
      body: 'Load the mini-board and click the edge: its Network tab shows the handshake RTTs. Change the stack to TLS 1.2, then to HTTP/3 (UDP › QUIC › HTTP/3), and watch the “new connection” latency change by one round trip each time. Trace a request to see every message.',
      focusIds: ['edge_client-api'],
    },
  ],
  quiz: [
    {
      question:
        'How many round trips before the first HTTP request on a cold HTTPS (TCP + TLS 1.3) connection?',
      options: ['0', '1', '2', '3'],
      answerIndex: 2,
      explanation:
        'TCP takes 1 RTT and TLS 1.3 one more; the request goes out in the third round trip.',
    },
    {
      question: 'What does the server certificate prove?',
      options: [
        'That the server is fast',
        'That the server holds the private key for that domain',
        'That the client is logged in',
        'That the data is compressed',
      ],
      answerIndex: 1,
      explanation:
        'A CA-signed certificate binds the domain to a public key; the handshake proves possession of the private key.',
    },
    {
      question: 'Why is HTTP/3 faster to connect?',
      options: [
        'It skips encryption',
        'QUIC combines the transport and TLS handshakes into one round trip',
        'It uses bigger packets',
        'It never needs DNS',
      ],
      answerIndex: 1,
      explanation:
        'QUIC carries the TLS 1.3 handshake in its own first flight, so a cold connection costs 1 RTT instead of 2.',
    },
  ],
  board,
  docs: {
    summary:
      'What TLS protects, the TCP + TLS 1.3 handshake message by message, and how TLS 1.2, resumption and QUIC change the round-trip cost.',
  },
});
