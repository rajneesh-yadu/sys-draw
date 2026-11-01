import { defineProtocol } from '../define';

export default defineProtocol({
  id: 'mqtt',
  name: 'MQTT',
  osiLayer: 7,
  handshakeRtts: 1, // CONNECT / CONNACK
  resumedHandshakeRtts: 1,
  perMessageOverheadBytes: 20, // 2 B fixed header + topic name + packet id
  multiplexing: false,
  reliable: true,
  ordered: true,
  encrypted: false,
  runsOn: ['tcp', 'tls13', 'tls12', 'websocket'],
  pattern: 'pub-sub',
  ports: { plain: [1883], secure: [8883] },
  handshakeSequence: [
    {
      from: 'client',
      message: 'CONNECT',
      detail: 'client id, keep-alive, credentials, clean start',
    },
    { from: 'server', message: 'CONNACK' },
  ],
  docs: {
    summary:
      'Lightweight publish/subscribe for IoT and mobile: tiny headers, persistent sessions and three delivery levels (QoS 0 at most once, 1 at least once, 2 exactly once) through a broker.',
    handshakeSteps: [
      'CONNECT → CONNACK (1 RTT after TCP/TLS)',
      'SUBSCRIBE to topic filters (sensors/+/temp)',
      'PUBLISH with QoS; QoS 1 adds PUBACK, QoS 2 a four-step exchange',
    ],
    headerFields: [
      'Packet type + flags (2 B fixed header)',
      'Topic name',
      'Packet id (QoS > 0)',
      'Retain flag, last-will message',
    ],
    securityNotes: [
      'Use TLS on 8883 and per-device credentials or client certificates.',
      'Restrict which topics each client may publish/subscribe to (ACLs); wildcards leak data.',
    ],
  },
});
