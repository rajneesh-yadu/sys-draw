# network

Protocol stacks: handshake, overhead and loss math, and the inspector's views (OSI layers, handshake sequence, ports, encryption, warnings). Pure TS over registry protocol entries.

- **Depends on:** `core`, `registry` · **Used by:** `engine` (edge latency, packet loss), `inspector` (edge Network tab) · **Built in:** S14
- **Rules:** Pure TS, no React; functions take a resolved stack, never a store or a board.

## Public API (index.ts)

- `resolveStack(registry, ids) → ResolvedStack` (`layers` bottom-up, `unknown` ids, `transport` = top-most layer with `loss`). A stack with no layer ≤ 4 (saved before S14, e.g. `['postgres-wire']`) gets TCP marked `assumed`. `activeLayers`, `stackLabel` ("TCP › TLS 1.3 › HTTP/2").
- `connectionCost(stack, rttMs, warm = false) → { rtts, ms, steps, explain }` — Σ layer `handshakeRtts` × RTT; `warm: true` = reused (0), `'resumed'` = `resumedHandshakeRtts` (TLS 1.3 / QUIC 0-RTT).
- `requestLatency(stack, rttMs, warm)` — handshake + 1 RTT (cold HTTP/1.1 = HTTP/2 = 3 RTT over TLS 1.3, HTTP/3 = 2 RTT).
- `perRequestOverhead(stack, payload | { req, res }) → { payloadBytes, overheadBytes, wireBytes, perLayer, explain }` — top-down, a layer's header once per message or once per `unitBytes` (TLS record 16 384, TCP MSS 1460, QUIC 1200, UDP 1472); encodings scale the payload (`payloadSizeFactor`). Implicit layers (IPv4, Ethernet) are not added (TCP/UDP entries include the IP header).
- `lossDelay(stack, rttMs, lossRate, bytes)` — P(any of ⌈bytes/segment⌉ lost) × max(`minRecoveryMs`, `recoveryRtts` × RTT) of the transport (TCP ≥ 200 ms RTO ≈ 3 RTT; QUIC 9/8 RTT; UDP: app retry 1 s).
- Inspector: `osiView(registry, stack)` (7 rows, implicit IPv4/Ethernet/fibre, notes), `handshakeSequence(stack, warm)` (per layer: messages, RTTs, start RTT), `stackPorts`, `isEncrypted`, `encryptionStatus`, `stackWarnings(registry, stack, { crossesInternet?, lossRate?, newConnectionShare? })`, `OSI_LAYER_NAMES`.

## Not modelled (yet)

- Head-of-line blocking is explained and warned about, not added to latency; TCP slow start (multi-RTT large responses), bandwidth/serialisation time and DNS lookups are not in the numbers. Request traces (S15) build on `handshakeSequence`.

## Extension points

- New protocol = a registry entry (`src/registry/protocols/<id>.ts`) with `handshakeRtts`, `resumedHandshakeRtts?`, `perMessageOverheadBytes`, `unitBytes?`, `loss?` (transports), `ports?`, `handshakeSequence?`, `suggestedStacks?` — no code here changes.
