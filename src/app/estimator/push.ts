import type { ScenarioPatch } from '@/estimator';
import type { BoardStore } from '@/store';

/** Apply an estimator patch to the board as one undoable `updateScenario` command. */
export function pushEstimateToBoard(board: BoardStore, patch: ScenarioPatch) {
  return board.getState().dispatch({ type: 'updateScenario', patch });
}
