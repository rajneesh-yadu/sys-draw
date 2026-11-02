import { expect, test } from '@playwright/test';

/**
 * S17 / F3: the problem browser filters the library, "Start problem" creates a board in the chosen
 * mode with the problem's scenario, and the reference design loads onto a board (production build).
 */
test.use({ viewport: { width: 1700, height: 1000 } });

test('S17: browse → filter → start a problem → load its reference design', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('open-problem-brief')).toHaveCount(0);

  // Browse and filter.
  await page.getByTestId('open-problems').click();
  const browser = page.getByTestId('problem-browser');
  await expect(browser.getByTestId('problem-count')).toHaveText('12 of 12 problems');
  await browser.getByLabel('Company style').selectOption('meta');
  await browser.getByLabel('Level').selectOption('4');
  await expect(browser.getByTestId('problem-count')).toHaveText('1 of 12 problems');
  await browser.getByTestId('problem-item-problem.instagram').click();
  await expect(browser.getByTestId('problem-scale')).toContainText('500M');

  // Start in Guided mode on an empty board.
  await browser.getByRole('radio', { name: /Guided/ }).check();
  await browser.getByRole('button', { name: /Start problem/ }).click();
  await expect(browser).toHaveCount(0);
  await expect(page.getByTestId('board-mode')).toHaveValue('guided');
  await expect(page.getByTestId('board-title')).toContainText('Instagram · Guided');
  await expect(page.locator('.react-flow__node-component')).toHaveCount(0);

  // The brief shows hints one at a time and loads the reference design.
  await page.getByTestId('open-problem-brief').click();
  const brief = page.getByTestId('problem-brief');
  await brief.getByRole('button', { name: 'Show first hint' }).click();
  await expect(brief.getByTestId('hints').locator('li')).toHaveCount(1);
  await brief.getByRole('button', { name: /Load reference solution/ }).click();
  await expect(brief).toHaveCount(0);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(11);
  await expect(page.getByTestId('region-canvas')).toContainText('Feed cache (Redis)');

  // One undo step clears it again.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.react-flow__node-component')).toHaveCount(0);

  // Interview mode hides hints.
  await page.getByTestId('open-problems').click();
  await page.getByTestId('problem-item-problem.uber').click();
  await page.getByRole('radio', { name: /Interview/ }).check();
  await page.getByRole('button', { name: /Start problem/ }).click();
  await expect(page.getByTestId('board-mode')).toHaveValue('interview');
  await page.getByTestId('open-problem-brief').click();
  await expect(page.getByTestId('hints-hidden')).toBeVisible();
  expect(errors).toEqual([]);
});
