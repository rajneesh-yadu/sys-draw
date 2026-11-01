import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'sse',
  name: 'Server-Sent Events',
  osiLayer: 7,
  handshakeRtts: 0,
  perMessageOverheadBytes: 10, // "data: " prefix, optional "id:" and the blank-line terminator
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['http2', 'http1', 'http3'],
  pattern: 'server-push',
  ports: { plain: [80], secure: [443] },
  docs: {
    summary:
      'One long HTTP response that the server keeps writing events into (text/event-stream). Simple one-way push for notifications and live feeds; browsers reconnect automatically.',
    handshakeSteps: [
      'A normal GET with Accept: text/event-stream',
      'The server answers 200 and never closes the response; events follow as they happen',
    ],
    headerFields: [
      'Content-Type: text/event-stream',
      'Event fields: data, event, id, retry',
      'Last-Event-ID on reconnect (resume where it stopped)',
    ],
    securityNotes: [
      'Each open stream holds a connection; over HTTP/1.1 browsers allow only ~6 per host.',
      'Authenticate with cookies or a token in the URL carefully — URLs end up in logs.',
    ],
  },
});
