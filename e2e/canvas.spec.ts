import { expect, test, type Page } from '@playwright/test';

/** F1: build client → CDN → LB → 2 servers → DB by drag-and-drop, then undo/redo every step. */
test.use({ viewport: { width: 1600, height: 900 } });

async function connect(page: Page, a: string, b: string) {
  const s = await page
    .locator(`.react-flow__node[data-id="${a}"] .react-flow__handle.source`)
    .first()
    .boundingBox();
  const t = await page
    .locator(`.react-flow__node[data-id="${b}"] .react-flow__handle.target`)
    .first()
    .boundingBox();
  if (!s || !t) throw new Error('handle not found');
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move((s.x + t.x) / 2, (s.y + t.y) / 2, { steps: 5 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 5 });
  await page.mouse.up();
}

test('F1: six-node design by drag-and-drop, then undo/redo all steps', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByTestId('board-canvas');
  const place: [string, number, number][] = [
    // Two rows, so the design fits the canvas next to the project sidebar (S06).
    ['client.app', 110, 100],
    ['network.cdn', 360, 100],
    ['network.load-balancer', 610, 100],
    ['compute.app-server', 110, 330],
    ['compute.app-server', 360, 330],
    ['database.sql', 610, 330],
  ];
  for (const [defId, x, y] of place) {
    await page.locator(`[data-def-id="${defId}"]`).dragTo(canvas, { targetPosition: { x, y } });
  }
  const nodes = page.locator('.react-flow__node-component');
  await expect(nodes).toHaveCount(6);
  const ids = await nodes.evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
  const [client, cdn, lb, a, b, db] = ids as [string, string, string, string, string, string];
  for (const [x, y] of [
    [client, cdn],
    [cdn, lb],
    [lb, a],
    [lb, b],
    [a, db],
    [b, db],
  ] as const) {
    await connect(page, x, y);
  }
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
  await expect(page.getByText('load-balancer-1')).toBeVisible();

  for (let i = 0; i < 12; i++) await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  for (let i = 0; i < 12; i++) await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
});
