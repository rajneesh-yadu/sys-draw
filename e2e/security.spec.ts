import { expect, test, type Page } from '@playwright/test';

/**
 * S16 done-when: a DB placed in a public zone raises a critical finding with a one-click fix.
 * App server + PostgreSQL; the DB is grouped into a subnet marked Public; the Security overlay
 * shows a critical finding and colours the DB as internet-facing; "Fix" turns the subnet into a
 * private data zone in one undoable step.
 */
test.use({ viewport: { width: 1700, height: 1000 } });

async function drop(page: Page, defId: string, x: number, y: number) {
  await page
    .locator(`[data-def-id="${defId}"]`)
    .dragTo(page.getByTestId('board-canvas'), { targetPosition: { x, y } });
}

test('S16: DB in a public zone → critical finding → one-click fix', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await drop(page, 'compute.app-server', 160, 220);
  await drop(page, 'database.postgres', 640, 220);
  const db = page.locator('.react-flow__node-component').nth(1);
  await expect(db).toContainText('PostgreSQL');

  // Group the DB into a subnet and mark the subnet public.
  await db.click();
  await page.locator('#sd-group-kind').selectOption('subnet');
  await page.getByRole('button', { name: 'Group as' }).click();
  await expect(page.getByTestId('group-node')).toHaveCount(1);
  await page.locator('.sd-group-header').first().click();
  const inspector = page.getByTestId('region-inspector');
  await inspector.getByRole('switch', { name: 'Security' }).check();
  await inspector.getByRole('switch', { name: 'Public (reachable from the internet)' }).check();
  await expect(page.getByTestId('group-zone')).toHaveText('Public zone');

  // Security overlay + review.
  await page.getByRole('button', { name: /^Security/ }).click();
  const panel = page.getByRole('complementary', { name: 'Security review' });
  const critical = panel.locator('[data-testid="security-finding"][data-severity="critical"]');
  await expect(critical).toHaveCount(1);
  await expect(critical).toContainText('is in a public zone');
  await expect(page.getByTestId('security-badge')).toBeVisible();
  await expect(db.locator('[data-exposure]')).toHaveAttribute('data-exposure', 'exposed');
  await expect(db.getByTestId('exposure-badge')).toHaveText('Internet-facing');

  // One click fixes it.
  await critical.getByRole('button', { name: /^Fix: Make .* a private data zone$/ }).click();
  await expect(panel.getByRole('status')).toContainText('Applied');
  await expect(critical).toHaveCount(0);
  await expect(db.locator('[data-exposure]')).toHaveAttribute('data-exposure', 'internal');
  await expect(page.getByTestId('group-zone')).toHaveText('Data zone');

  // …and it is one undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(critical).toHaveCount(1);
  expect(errors).toEqual([]);
});
