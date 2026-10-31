# network

Protocol stacks, handshake and overhead math, request-trace generation.

- **Depends on:** `core`, `registry`
- **Rules:** Pure TS; reads protocol definitions from the registry.
- **Built in:** session S14

## Public API (index.ts)

- _Empty — scaffold only._

## Extension points

- New protocol = registry entry; new trace steps only for new handshakes.
