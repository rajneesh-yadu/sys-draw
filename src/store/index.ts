/**
 * store — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
export {
  createBoardStore,
  PASTE_OFFSET,
  type BoardState,
  type BoardStore,
  type BoardStoreOptions,
  type DispatchResult,
  type HistoryEntry,
} from './board-store';
export {
  applyCommand,
  commandLabel,
  groupKindLabel,
  CommandError,
  type BoardCommand,
  type CommandContext,
  type NodeMove,
} from './commands';
export {
  checkConnection,
  defaultProtocolStack,
  rankProtocols,
  type ConnectionCheck,
  type ConnectionRequest,
} from './connections';
export { extractSubgraph, cloneSubgraph } from './clipboard';
export { descendantsOf } from './graph-utils';
export { emptyBoardDoc, type BoardDoc, type BoardLayout, type Rect, type Subgraph } from './types';
export { boardStore, useBoardStore, useBoardStoreApi } from './context';
export { BoardStoreProvider } from './BoardStoreProvider';

// Graph types re-exported for the UI modules that may not import core directly (canvas, inspector).
export {
  GROUP_KINDS,
  type Graph,
  type NodeInstance,
  type EdgeInstance,
  type Group,
  type GroupKind,
  type Position,
  type ProviderId,
} from '@/core';
