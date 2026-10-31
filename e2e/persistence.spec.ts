import { expect, test, type Page } from '@playwright/test';

/** F9: projects with many boards survive a reload exactly; snapshots, rename, export/import. */
test.use({ viewport: { width: 1600, height: 900 } });

async function drop(page: Page, defId: string, x: number, y: number) {
  await page
    .locator(`[data-def-id="${defId}"]`)
    .dragTo(page.getByTestId('board-canvas'), { targetPosition: { x, y } });
}

const tabs = (page: Page) => page.getByTestId('board-tabs').getByRole('tab');

async function saved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
}

test('create 2 boards, reload, both intact', async ({ page }) => {
  await page.goto('/');
  await expect(tabs(page)).toHaveText(['Board 1']);

  // Board 1: client + LB.
  await drop(page, 'client.app', 200, 300);
  await drop(page, 'network.load-balancer', 500, 300);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(2);

  // Board 2 (renamed): three app servers.
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(tabs(page)).toHaveText(['Board 1', 'Board 2']);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(0);
  for (const y of [150, 300, 450]) await drop(page, 'compute.app-server', 400, y);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(3);
  await tabs(page).filter({ hasText: 'Board 2' }).dblclick();
  await page.getByRole('textbox', { name: 'Board name' }).fill('Servers');
  await page.keyboard.press('Enter');

  // A snapshot on Board 2.
  await page.getByRole('button', { name: /Snapshots/ }).click();
  await page.getByRole('textbox', { name: 'Snapshot name' }).fill('Three servers');
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await page.keyboard.press('Escape');

  await saved(page);
  // Nodes also show simulation overlays (S08): compare once the run has finished.
  await expect(page.getByTestId('sim-status')).toHaveAttribute('data-status', 'done');
  const before = await page
    .locator('.react-flow__node-component')
    .evaluateAll((els) => els.map((e) => [e.getAttribute('data-id'), e.textContent]));

  await page.reload();

  await expect(tabs(page)).toHaveText(['Board 1', 'Servers']);
  // The last open board reopens, with the same nodes.
  await expect(tabs(page).filter({ hasText: 'Servers' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.react-flow__node-component')).toHaveCount(3);
  await expect(page.getByTestId('sim-status')).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('node-overlay')).toHaveCount(3);
  const after = await page
    .locator('.react-flow__node-component')
    .evaluateAll((els) => els.map((e) => [e.getAttribute('data-id'), e.textContent]));
  expect(after).toEqual(before);
  await expect(page.getByRole('button', { name: 'Snapshots (1)' })).toBeVisible();

  await tabs(page).filter({ hasText: 'Board 1' }).click();
  await expect(page.locator('.react-flow__node-component')).toHaveCount(2);
  await expect(page.getByText('load-balancer-1')).toBeVisible();
});

test('exported project JSON re-imports on a fresh profile', async ({ page, browser }) => {
  await page.goto('/');
  await drop(page, 'database.sql', 400, 300);
  await page.getByRole('button', { name: 'New board' }).click();
  await drop(page, 'cache.in-memory', 400, 300);
  await saved(page);

  await page.getByRole('button', { name: /Project My project actions/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export JSON' }).click();
  const file = await (await download).path();

  const fresh = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const p2 = await fresh.newPage();
  await p2.goto('/');
  await p2.getByTestId('import-input').setInputFiles(file);
  await expect(p2.getByText(/Imported 1 project \(2 boards\)/)).toBeVisible();
  await expect(p2.getByRole('tablist', { name: 'Boards in My project 2' })).toBeVisible();
  await expect(tabs(p2)).toHaveText(['Board 1', 'Board 2']);
  await expect(p2.locator('.react-flow__node-component')).toHaveCount(1);
  await tabs(p2).filter({ hasText: 'Board 1' }).click();
  await expect(p2.getByText('sql-database-1')).toBeVisible();
  await fresh.close();
});
