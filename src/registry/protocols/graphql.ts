import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'graphql',
  name: 'GraphQL',
  osiLayer: 7,
  handshakeRtts: 0,
  perMessageOverheadBytes: 200, // the query document sent with each request (unless persisted)
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['http2', 'http1', 'http3', 'websocket'],
  pattern: 'request-response',
  ports: { plain: [80], secure: [443] },
  docs: {
    summary:
      'Query language over HTTP: the client asks for exactly the fields it needs from one endpoint, which avoids over-fetching and many round trips; subscriptions push updates over WebSocket.',
    handshakeSteps: [
      'No handshake of its own: a POST /graphql on an existing HTTP connection',
      'Subscriptions: a WebSocket with a graphql-transport-ws init message',
    ],
    headerFields: [
      'POST body { query, variables, operationName }',
      'Persisted query hash (instead of the full query)',
      'Response { data, errors }',
    ],
    securityNotes: [
      'Limit query depth and cost; one nested query can fan out to millions of resolver calls.',
      'Disable introspection in production or accept that your schema is public.',
      'Authorise per field/resolver, not only at the endpoint.',
    ],
  },
});
