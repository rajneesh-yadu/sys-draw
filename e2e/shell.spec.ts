import { expect, test } from '@playwright/test';

test('app shell shows all five regions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SysDraw' })).toBeVisible();
  for (const id of ['topbar', 'palette', 'canvas', 'inspector', 'metrics']) {
    await expect(page.getByTestId(`region-${id}`)).toBeVisible();
  }
});
