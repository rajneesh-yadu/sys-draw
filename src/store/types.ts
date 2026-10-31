/** Board state held by the store. Positions and frames are absolute canvas coordinates. */
import type { Graph, ProviderId, Scenario } from '@/core';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * View-only layout the core Board schema has no field for yet (group position/size).
 * Kept in the store so it is undoable; not persisted until core adds it (see PROGRESS.md S04).
 */
export interface BoardLayout {
  groupFrames: Record<string, Rect>;
}

export interface BoardDoc {
  providerId: ProviderId;
  graph: Graph;
  layout: BoardLayout;
  /** Traffic and conditions to simulate; edited by the inspector's board panel (S05). */
  scenario: Scenario;
}

/** A self-contained piece of a board (clipboard contents, paste payload). */
export interface Subgraph {
  nodes: Graph['nodes'];
  edges: Graph['edges'];
  groups: Graph['groups'];
  frames: Record<string, Rect>;
}

/** Starting scenario for a new board: modest traffic from North America, no flows or chaos yet. */
export function defaultScenario(): Scenario {
  return {
    usersByRegion: { 'north-america': 1000 },
    flows: [],
    peakMultiplier: 2,
    diurnal: true,
    payloadBytes: { req: 1000, res: 10_000 },
    events: [],
    seed: 1,
    durationSec: 60,
  };
}

export function emptyBoardDoc(providerId: ProviderId = 'generic'): BoardDoc {
  return {
    providerId,
    graph: { nodes: [], edges: [], groups: [] },
    layout: { groupFrames: {} },
    scenario: defaultScenario(),
  };
}
