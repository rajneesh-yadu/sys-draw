/** S20: calculator UI — inputs, formulas, validation, push, latency card. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Scenario } from '@/core';
import {
  DEFAULT_ESTIMATOR_INPUTS,
  EstimatorButton,
  EstimatorPanel,
  draftFromInputs,
  inputsFromDraft,
  parseNumber,
} from './index';

const scenario: Scenario = {
  usersByRegion: { 'north-america': 1000 },
  flows: [],
  peakMultiplier: 2,
  diurnal: true,
  payloadBytes: { req: 1000, res: 10_000 },
  events: [],
  seed: 1,
  durationSec: 60,
};
const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
const value = (id: string) => screen.getByTestId(`estimate-${id}-value`).textContent;

describe('parseNumber / drafts', () => {
  it('reads plain numbers, separators and k/M/B/T suffixes', () => {
    expect(parseNumber('100M')).toBe(1e8);
    expect(parseNumber('1.5k')).toBe(1500);
    expect(parseNumber('2,000')).toBe(2000);
    expect(parseNumber(' 3 b ')).toBe(3e9);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('ten')).toBeNaN();
    expect(parseNumber('-1')).toBeNaN();
  });
  it('round-trips the defaults through a draft', () => {
    const d = draftFromInputs(DEFAULT_ESTIMATOR_INPUTS);
    expect(d).toMatchObject({
      dau: '100M',
      objectSize: '10',
      objectSizeUnit: 'KB',
      hotDataPercent: '20',
    });
    expect(inputsFromDraft(d)).toEqual({ ok: true, inputs: DEFAULT_ESTIMATOR_INPUTS });
  });
});

describe('EstimatorPanel', () => {
  it('F12: DAU 100M with 10 requests/day shows ≈ 11.6k avg QPS and its formula', () => {
    render(<EstimatorPanel />);
    type('est-dau', '100M');
    type('est-actions', '10');
    expect(value('qpsAvg')).toBe('11.6k rps');
    const row = screen.getByTestId('estimate-qpsAvg');
    expect(row).toHaveTextContent('QPS_avg = requests/day ÷ 86 400 s');
    expect(row).toHaveTextContent('1B ÷ 86 400 = 11.6k rps');
    // Every section is shown.
    for (const name of ['Traffic', 'Storage', 'Bandwidth', 'Cache']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('recomputes on unit and ratio changes', () => {
    render(<EstimatorPanel />);
    fireEvent.change(screen.getByTestId('est-size-unit'), { target: { value: 'MB' } });
    expect(value('storagePerDay')).toBe('909.09 TB'); // 1e9/11 writes × 10 MB
    type('est-read', '1');
    type('est-write', '0');
    expect(value('writeQps')).toBe('0 rps');
  });

  it('flags invalid input and keeps the last valid estimate', () => {
    render(<EstimatorPanel />);
    type('est-dau', 'lots');
    expect(screen.getByTestId('est-dau')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Enter a number/)).toBeInTheDocument();
    expect(screen.getByText(/Showing the last valid estimate/)).toBeInTheDocument();
    expect(value('qpsAvg')).toBe('11.6k rps');
    type('est-peak', '0.5');
    expect(screen.getByText('Must be ≥ 1')).toBeInTheDocument();
    type('est-dau', '100M');
    type('est-read', '0');
    type('est-write', '0');
    expect(screen.getByRole('alert')).toHaveTextContent(/both be 0/);
  });

  it('pushes the patch to the scenario and reports the result', () => {
    const onPush = vi.fn(() => ({ ok: true as const }));
    render(<EstimatorPanel scenario={scenario} onPush={onPush} />);
    const changes = screen.getByRole('list', { name: 'What the push changes' });
    expect(within(changes).getByText(/Daily cycle turned off/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('estimator-push'));
    expect(onPush).toHaveBeenCalledTimes(1);
    const patch = (onPush.mock.calls[0] as unknown as [Partial<Scenario>])[0];
    expect(patch.usersByRegion).toEqual({ 'north-america': 100_000_000 });
    expect(patch.peakMultiplier).toBe(2);
    expect(screen.getByTestId('estimator-push-status')).toHaveTextContent(
      'Scenario updated: 100M users · 1 flow · peak ×2 → 11.6k avg rps, 23.1k peak rps.',
    );
  });

  it('shows a rejected push and disables push while inputs are invalid', () => {
    const onPush = vi.fn(() => ({ ok: false as const, reason: 'Invalid scenario: nope' }));
    render(<EstimatorPanel scenario={scenario} onPush={onPush} />);
    fireEvent.click(screen.getByTestId('estimator-push'));
    expect(screen.getByTestId('estimator-push-status')).toHaveTextContent('Invalid scenario: nope');
    type('est-dau', '?');
    expect(screen.getByTestId('estimator-push')).toBeDisabled();
  });

  it('has no push button without onPush, and shows the latency card', () => {
    render(<EstimatorPanel />);
    expect(screen.queryByTestId('estimator-push')).toBeNull();
    const card = screen.getByTestId('latency-card');
    expect(within(card).getByTestId('latency-dcRtt')).toHaveTextContent('500 µs');
    expect(within(card).getByTestId('latency-transatlantic')).toHaveTextContent('150 ms');
  });
});

describe('EstimatorButton', () => {
  it('opens the dialog and keeps the draft after closing', () => {
    render(<EstimatorButton scenario={scenario} onPush={() => ({ ok: true })} />);
    fireEvent.click(screen.getByTestId('open-estimator'));
    expect(screen.getByRole('dialog', { name: 'Back-of-envelope estimate' })).toBeInTheDocument();
    type('est-dau', '1M');
    fireEvent.keyDown(screen.getByTestId('estimator-dialog'), { key: 'Escape' });
    expect(screen.queryByTestId('estimator-dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('open-estimator'));
    expect(screen.getByTestId('est-dau')).toHaveValue('1M');
    expect(value('qpsAvg')).toBe('116 rps');
  });
});
