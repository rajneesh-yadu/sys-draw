import { expect, test } from '@playwright/test';

/**
 * S18 / F11 acceptance (production build): each of the six modes can be entered on any board,
 * and Debug mode loads a broken design and confirms when it is fixed. Also: Guided steps,
 * Interview scorecard, Chaos injection, a Learn lesson with its mini-board and quiz, Progress.
 */
test.use({ viewport: { width: 1800, height: 1050 } });

test('S18: six modes on one board; Debug confirms the fix; progress is recorded', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const mode = page.getByTestId('board-mode');
  const panel = page.getByTestId('mode-panel');

  // Sandbox: free play, no panel.
  await expect(mode).toHaveValue('sandbox');
  await expect(panel).toHaveCount(0);

  // Guided on a free board: pick a problem, walk the step cards.
  await mode.selectOption('guided');
  await expect(panel).toHaveAttribute('data-mode', 'guided');
  await panel.getByLabel('Problem').selectOption('problem.url-shortener');
  await panel.getByRole('button', { name: 'Practise this problem' }).click();
  await expect(page.getByTestId('guided-step')).toContainText('1. Requirements');
  await panel.getByRole('button', { name: /Step 2: Back-of-envelope/ }).click();
  await panel.getByLabel('Peak requests/s').fill('30000');
  await expect(page.getByTestId('guided-step')).toContainText('ours ≈ 31k rps');

  // Interview: 45-minute clock, hints hidden, finish → scorecard.
  await mode.selectOption('interview');
  await expect(panel).toHaveAttribute('data-mode', 'interview');
  await expect(page.getByTestId('interview-clock')).toHaveText(/^4[45]:\d\d$/);
  await page.getByTestId('open-problem-brief').click();
  await expect(page.getByTestId('hints-hidden')).toBeVisible();
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Finish interview' }).click();
  await expect(page.getByTestId('scorecard')).toBeVisible();
  await expect(page.getByTestId('score-total')).toHaveText(/^\d+$/);

  // Learn: a lesson with a mini-board, loaded onto the canvas, quiz passed.
  await mode.selectOption('learn');
  await page.getByTestId('lesson-lesson.cache-aside').click();
  const player = page.getByTestId('lesson-player');
  await expect(player.getByTestId('mini-board')).toBeVisible();
  await player.getByRole('button', { name: /Try it on the board/ }).click();
  await expect(page.locator('.react-flow__node-component')).toHaveCount(4);
  for (let i = 0; i < 4; i++)
    await player.getByRole('button', { name: /^(Next|Take the quiz)/ }).click();
  const quiz = page.getByTestId('lesson-quiz');
  await quiz.getByRole('radio', { name: '1,000/s to 100/s' }).check();
  await quiz.getByRole('radio', { name: 'The application after reading the DB' }).check();
  await quiz.getByRole('radio', { name: /Request coalescing/ }).check();
  await quiz.getByRole('button', { name: 'Check answers' }).click();
  await expect(page.getByTestId('quiz-result')).toHaveText('3 / 3 right — passed');

  // Chaos: inject a failure into the lesson's design; the timeline is judged.
  await mode.selectOption('chaos');
  await expect(panel).toHaveAttribute('data-mode', 'chaos');
  await panel.getByRole('button', { name: /Traffic spike/ }).click();
  await expect(panel).toContainText('1 failure scheduled');
  await expect(page.getByTestId('chaos-summary')).not.toHaveText(/Inject a failure|Waiting/);

  // Debug: load a broken design → symptoms → fix it → confirmed.
  await mode.selectOption('debug');
  await expect(panel).toHaveAttribute('data-mode', 'debug');
  await panel
    .getByLabel('Broken design')
    .selectOption({ label: 'L1 · Rate limiter: API keys travel in the clear' });
  await panel.getByRole('button', { name: 'Load broken design' }).click();
  await expect(page.getByTestId('debug-symptoms')).toContainText('Plaintext over the internet');
  await expect(page.getByTestId('debug-fixed')).toHaveCount(0);
  await page.getByRole('button', { name: /^Security/ }).click();
  const review = page.getByRole('complementary', { name: 'Security review' });
  await review
    .getByRole('listitem')
    .filter({ hasText: 'Plaintext over the internet' })
    .getByRole('button', { name: 'Fix: Encrypt with TLS 1.3' })
    .click();
  await expect(page.getByTestId('debug-fixed')).toContainText('Fixed', { timeout: 15_000 });
  await expect(panel).toHaveAttribute('data-complete', 'true');

  // Back to Sandbox; Progress lists the lesson and the debug fix.
  await mode.selectOption('sandbox');
  await expect(panel).toHaveCount(0);
  await page.getByTestId('open-progress').click();
  const progress = page.getByTestId('progress-page');
  await expect(progress.getByTestId('progress-row-lesson.cache-aside')).toContainText('100');
  await expect(progress.getByTestId('progress-row-problem.rate-limiter')).toContainText('Debug');
  expect(errors).toEqual([]);
});
