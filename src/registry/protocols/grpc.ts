import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'grpc',
  name: 'gRPC',
  osiLayer: 7,
  handshakeRtts: 0,
  perMessageOverheadBytes: 25, // 5 B length-prefixed message header + gRPC trailers/headers amortised
  multiplexing: true,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['http2'],
  docs: {
    summary:
      'RPC framework that sends Protocol Buffers messages over HTTP/2 streams. Compact, typed and supports streaming in both directions — the default for service-to-service calls.',
    handshakeSteps: [
      'Uses an existing HTTP/2 connection; no handshake of its own',
      'Each call is one HTTP/2 stream: HEADERS (:path = /package.Service/Method), DATA frames with length-prefixed messages, then trailers carrying grpc-status',
    ],
    headerFields: [
      ':path /package.Service/Method',
      'content-type: application/grpc',
      'grpc-timeout (deadline propagated to the server)',
      'grpc-status / grpc-message trailers',
      'Custom metadata (e.g. authorization)',
    ],
    securityNotes: [
      'Use TLS or mTLS between services; plaintext gRPC is common inside meshes and easy to forget.',
      'Always set deadlines — a call without one can hold resources forever during an outage.',
      'Browsers cannot call gRPC directly; gRPC-Web needs a proxy.',
    ],
  },
});
