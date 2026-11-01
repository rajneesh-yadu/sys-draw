/**
 * network — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md. Implemented in S14.
 */
export {
  resolveStack,
  activeLayers,
  stackLabel,
  ASSUMED_TRANSPORT_ID,
  type ProtocolSource,
  type ResolvedStack,
  type StackLayer,
} from './stack';
export {
  connectionCost,
  requestLatency,
  perRequestOverhead,
  lossDelay,
  DEFAULT_SEGMENT_BYTES,
  type Warmth,
  type ConnectionCost,
  type HandshakeStep,
  type RequestLatency,
  type Overhead,
  type LayerOverhead,
  type LossDelay,
} from './cost';
export {
  osiView,
  handshakeSequence,
  stackPorts,
  isEncrypted,
  encryptionStatus,
  stackWarnings,
  OSI_LAYER_NAMES,
  type OsiRow,
  type OsiProtocol,
  type HandshakeGroup,
  type StackPorts,
  type EncryptionStatus,
  type StackWarning,
  type WarningContext,
} from './inspect';
