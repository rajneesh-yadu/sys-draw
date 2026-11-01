/**
 * S20: wires the estimator (which depends only on core) to the open board: it reads the board's
 * scenario and applies "Push to scenario" as one undoable `updateScenario` command.
 */
import { EstimatorButton } from '@/estimator';
import { useBoardStore, useBoardStoreApi } from '@/store';
import { pushEstimateToBoard } from './push';
import { useNotice } from '../workspace/notice-context';

export function EstimatorTopBarButton() {
  const board = useBoardStoreApi();
  const scenario = useBoardStore((s) => s.doc.scenario);
  const { show } = useNotice();
  return (
    <EstimatorButton
      scenario={scenario}
      onPush={(patch) => {
        const res = pushEstimateToBoard(board, patch);
        show(
          res.ok
            ? { kind: 'info', text: 'Estimate pushed to the scenario (undo with Ctrl/Cmd+Z).' }
            : { kind: 'error', text: res.reason },
        );
        return res;
      }}
    />
  );
}
