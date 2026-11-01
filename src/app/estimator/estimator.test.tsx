/** S20 — F12 acceptance: estimator → board scenario → engine load. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateLoad } from '@/engine';
import { BoardStoreProvider, createAppStores, type BoardStore } from '@/store';
import { EstimatorTopBarButton } from './EstimatorTopBarButton';

let board: BoardStore;

beforeEach(() => {
  board = createAppStores().boardStore;
  render(
    <BoardStoreProvider store={board}>
      <EstimatorTopBarButton />
    </BoardStoreProvider>,
  );
});

describe('Estimator in the app', () => {
  it('F12: DAU 100M × 10/day → ~11.6k avg QPS, pushed into the scenario as one undo step', () => {
    fireEvent.click(screen.getByTestId('open-estimator'));
    fireEvent.change(screen.getByTestId('est-dau'), { target: { value: '100M' } });
    fireEvent.change(screen.getByTestId('est-actions'), { target: { value: '10' } });
    expect(screen.getByTestId('estimate-qpsAvg-value')).toHaveTextContent('11.6k rps');

    const before = board.getState().doc.scenario;
    fireEvent.click(screen.getByTestId('estimator-push'));
    const s = board.getState().doc.scenario;
    expect(s.peakMultiplier).toBe(2);
    expect(s.diurnal).toBe(false);

    // The engine's load step reproduces the estimate: avg = peak load ÷ peak multiplier.
    const peakRps = generateLoad(s).reduce((sum, f) => sum + f.rps, 0);
    expect(peakRps / s.peakMultiplier).toBeCloseTo(11_574.074, 1);
    expect(peakRps).toBeCloseTo(23_148.148, 1);

    board.getState().undo();
    expect(board.getState().doc.scenario).toEqual(before);
  });
});
