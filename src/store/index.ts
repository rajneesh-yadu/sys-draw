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
  type EdgeConfigPatch,
  type NodeMove,
  type NodeScalingPatch,
} from './commands';
export {
  checkConnection,
  checkProtocolStack,
  defaultProtocolStack,
  edgeProtocolStackOptions,
  edgeSharedProtocols,
  protocolStackOptions,
  rankProtocols,
  type ConnectionCheck,
  type ConnectionRequest,
} from './connections';
export { extractSubgraph, cloneSubgraph } from './clipboard';
export { descendantsOf } from './graph-utils';
export {
  defaultScenario,
  emptyBoardDoc,
  type BoardDoc,
  type BoardLayout,
  type Rect,
  type Subgraph,
} from './types';
export {
  createAppStores,
  boardStore,
  useBoardStore,
  useBoardStoreApi,
  workspaceStore,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from './context';
export { BoardStoreProvider } from './BoardStoreProvider';
export { WorkspaceStoreProvider } from './WorkspaceStoreProvider';

// Workspace: projects, board tabs, snapshots (S06).
export {
  createWorkspaceStore,
  type WorkspaceResult,
  type WorkspaceState,
  type WorkspaceStore,
  type WorkspaceStoreOptions,
} from './workspace-store';
export {
  DEFAULT_BOARD_PREFIX,
  DEFAULT_PROJECT_NAME,
  WorkspaceError,
  boardsOfProject,
  emptyWorkspaceData,
  graphDiff,
  newBoard,
  normalizeWorkspace,
  projectOfBoard,
  uniqueName,
  type GraphDiff,
  type ImportedBoards,
  type ImportedProjects,
  type WorkspaceData,
  type WorkspaceDeps,
} from './workspace';

// Graph types re-exported for the UI modules that may not import core directly (canvas, inspector).
// The schemas are re-exported so the inspector can generate forms from the same source of truth.
export {
  GROUP_KINDS,
  AutoscaleSchema,
  EdgeConfigSchema,
  FirewallRuleSchema,
  GroupSchema,
  NodeScalingSchema,
  ScenarioSchema,
  type Autoscale,
  type EdgeConfig,
  type FirewallRule,
  type NodeScaling,
  type Scenario,
  type Graph,
  type NodeInstance,
  type EdgeInstance,
  type Group,
  type GroupKind,
  type Position,
  type ProviderId,
  type Board,
  type Project,
  type Snapshot,
  type UserSettings,
} from '@/core';
