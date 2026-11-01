/** S18 mode UI: switcher, panels per mode, lesson player, progress page. */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import {
  BoardStoreProvider,
  SimulationStoreProvider,
  WorkspaceStoreProvider,
  createAppStores,
  createSimulationStore,
  type BoardStore,
  type SimulationStore,
  type WorkspaceStore,
} from '@/store';
import { createModeStore } from './mode-store';
import { createProgressStore, memoryProgressStorage, type ProgressStore } from './progress';
import { modes } from './registry';
import { startModeRunner, type ModeRunner } from './runner';
import { simulateBoard } from './test-utils';
import { ModePanel } from './ui/ModePanel';
import { ModesProvider } from './ui/ModesProvider';
import { ModeSwitcher } from './ui/ModeSwitcher';
import { ProgressButton } from './ui/ProgressPage';

let ws: WorkspaceStore;
let board: BoardStore;
let sim: SimulationStore;
let progress: ProgressStore;
let runner: ModeRunner;
let clock = 0;

function simulateNow() {
  act(() => {
    const doc = board.getState().doc;
    const id = sim.getState().start();
    sim.getState().finish(id, ws.getState().activeBoardId, simulateBoard(doc.graph, doc.scenario));
  });
}

beforeEach(() => {
  let i = 0;
  const s = createAppStores({ newId: (k) => `${k === 'group' ? 'grp' : k}_${++i}` });
  ws = s.workspaceStore;
  board = s.boardStore;
  sim = createSimulationStore();
  const modeStore = createModeStore();
  progress = createProgressStore(memoryProgressStorage());
  clock = Date.parse('2026-11-01T10:00:00Z');
  runner = startModeRunner({
    workspaceStore: ws,
    boardStore: board,
    simulationStore: sim,
    modeStore,
    progressStore: progress,
    registry,
    modes,
    now: () => clock,
    tickMs: 0,
  });
  render(
    <WorkspaceStoreProvider store={ws}>
      <BoardStoreProvider store={board}>
        <SimulationStoreProvider store={sim}>
          <ModesProvider modeStore={modeStore} progressStore={progress}>
            <ModeSwitcher />
            <ProgressButton />
            <ModePanel />
          </ModesProvider>
        </SimulationStoreProvider>
      </BoardStoreProvider>
    </WorkspaceStoreProvider>,
  );
});
afterEach(() => runner.dispose());

const switchTo = (mode: string) =>
  fireEvent.change(screen.getByTestId('board-mode'), { target: { value: mode } });

describe('mode switcher and panel', () => {
  it('lists the six modes; sandbox shows no panel; each other mode shows its panel', () => {
    const select = screen.getByTestId('board-mode') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      'sandbox',
      'guided',
      'interview',
      'debug',
      'chaos',
      'learn',
    ]);
    expect(screen.queryByTestId('mode-panel')).toBeNull();
    for (const [mode, panel] of [
      ['guided', 'guided-panel'],
      ['interview', 'interview-panel'],
      ['debug', 'debug-panel'],
      ['chaos', 'chaos-panel'],
      ['learn', 'learn-panel'],
    ] as const) {
      switchTo(mode);
      expect(screen.getByTestId('mode-panel')).toHaveAttribute('data-mode', mode);
      expect(screen.getByTestId(panel)).toBeInTheDocument();
    }
  });

  it('Guided on a free board offers a problem; picking one shows its requirements', () => {
    switchTo('guided');
    const picker = screen.getByTestId('problem-picker');
    fireEvent.change(within(picker).getByLabelText('Problem'), {
      target: { value: 'problem.url-shortener' },
    });
    fireEvent.click(within(picker).getByRole('button', { name: 'Practise this problem' }));
    expect(screen.queryByTestId('problem-picker')).toBeNull();
    const step = screen.getByTestId('guided-step');
    expect(step).toHaveTextContent('1. Requirements');
    expect(within(step).getAllByRole('checkbox').length).toBeGreaterThan(5);
    fireEvent.click(screen.getByRole('button', { name: /Step 3: API/ }));
    expect(screen.getByTestId('guided-step')).toHaveTextContent('3. API');
  });

  it('Interview: clock at 45:00, hints hidden; finishing shows the scorecard', () => {
    switchTo('interview');
    fireEvent.click(screen.getByRole('button', { name: 'Practise this problem' }));
    expect(screen.getByTestId('interview-clock')).toHaveTextContent('45:00');
    act(() => {
      clock += 6 * 60_000;
      runner.tick();
    });
    expect(screen.getByTestId('interview-clock')).toHaveTextContent('39:00');
    expect(screen.getByTestId('interview-prompts')).toHaveTextContent('which requirements');
    fireEvent.click(screen.getByRole('button', { name: 'Finish interview' }));
    expect(screen.getByTestId('scorecard')).toBeInTheDocument();
    expect(screen.getByTestId('score-total')).toHaveTextContent('0');
  });

  it('Debug: load a broken design, see symptoms, take a hint, fix it → confirmed', () => {
    switchTo('debug');
    const panel = screen.getByTestId('debug-panel');
    const options = [...within(panel).getByLabelText('Broken design').querySelectorAll('option')];
    const idx = options.findIndex((o) => o.textContent?.includes('Messages readable'));
    fireEvent.change(within(panel).getByLabelText('Broken design'), {
      target: { value: String(idx) },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Load broken design' }));
    expect(board.getState().doc.graph.nodes.length).toBeGreaterThan(5);
    simulateNow();
    expect(screen.getByTestId('debug-symptoms')).toHaveTextContent('Plaintext over the internet');
    fireEvent.click(screen.getByRole('button', { name: /Show a hint/ }));
    expect(screen.getByTestId('debug-hints').querySelectorAll('li')).toHaveLength(1);
    act(() => {
      board.getState().dispatch({
        type: 'updateEdge',
        edgeId: 'edge_client-waf',
        protocolStack: ['tcp', 'tls13', 'websocket'],
      });
    });
    simulateNow();
    expect(screen.getByTestId('debug-fixed')).toHaveTextContent('Score 75');
    expect(screen.getByTestId('mode-panel')).toHaveAttribute('data-complete', 'true');
  });

  it('Learn: open a lesson, step with the mini-board, pass the quiz; progress shows it', () => {
    switchTo('learn');
    fireEvent.click(screen.getByTestId('lesson-lesson.cache-aside'));
    const player = screen.getByTestId('lesson-player');
    expect(
      within(player).getByTestId('mini-board').querySelectorAll('[data-focus]').length,
    ).toBeGreaterThan(0);
    fireEvent.click(within(player).getByRole('button', { name: /Try it on the board/ }));
    expect(board.getState().doc.graph.nodes.map((n) => n.label)).toContain('Product cache (Redis)');
    const lesson = registry.require('lesson.cache-aside', 'lesson');
    for (let k = 0; k < lesson.steps.length; k++)
      fireEvent.click(within(player).getByRole('button', { name: /Next|Take the quiz/ }));
    const quiz = screen.getByTestId('lesson-quiz');
    lesson.quiz.forEach((q, qi) => {
      const group = within(quiz).getAllByRole('group')[qi]!;
      fireEvent.click(within(group).getAllByRole('radio')[q.answerIndex]!);
    });
    fireEvent.click(within(quiz).getByRole('button', { name: 'Check answers' }));
    expect(screen.getByTestId('quiz-result')).toHaveTextContent('3 / 3 right — passed');
    expect(screen.getByTestId('lesson-passed')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('open-progress'));
    const page = screen.getByTestId('progress-page');
    expect(within(page).getByTestId('progress-row-lesson.cache-aside')).toHaveTextContent('100');
    expect(within(page).getByTestId('progress-totals')).toHaveTextContent(
      '1 attempt · 1 completed',
    );
  });
});
