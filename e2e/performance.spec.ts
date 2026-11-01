import { expect, test, type Page } from '@playwright/test';

/** F7: overloaded node turns red; system panel shows p99 per flow; every number has a formula. */
test.use({ viewport: { width: 1600, height: 1000 } });

async function drop(page: Page, defId: string, x: number, y: number) {
  await page
    .locator(`[data-def-id="${defId}"]`)
    .dragTo(page.getByTestId('board-canvas'), { targetPosition: { x, y } });
}

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

const done = (page: Page) =>
  expect(page.getByTestId('sim-status')).toHaveAttribute('data-status', 'done');

test('F7: performance overlays, per-flow p99, bottleneck focus and formulas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await drop(page, 'client.app', 120, 160);
  await drop(page, 'network.load-balancer', 420, 160);
  await drop(page, 'compute.app-server', 720, 160);
  const nodes = page.locator('.react-flow__node-component');
  await expect(nodes).toHaveCount(3);
  const [client, lb, server] = (await nodes.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-id') ?? ''),
  )) as [string, string, string];
  await connect(page, client, lb);
  await connect(page, lb, server);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // Auto-run (debounced) in the worker: default 1 000 users → 200 rps, server healthy.
  await done(page);
  const serverNode = page.locator(`.react-flow__node[data-id="${server}"]`);
  await expect(serverNode.getByTestId('component-node')).toHaveAttribute('data-level', 'ok');
  await expect(serverNode.getByTestId('node-overlay')).toContainText('200 rps');
  await expect(serverNode.getByTestId('node-p99')).toContainText('p99');

  // Edges: thickness by rps (both carry the max here) and a latency label.
  const edgeLabels = page.getByTestId('edge-label');
  await expect(edgeLabels).toHaveCount(2);
  await expect(edgeLabels.first()).toHaveAttribute('data-stroke-width', '8');
  await expect(edgeLabels.first()).toContainText('ms');

  // System panel: KPIs and p99 per flow.
  const metrics = page.getByTestId('region-metrics');
  await expect(metrics.getByRole('button', { name: 'Throughput: show formula' })).toHaveText(
    '200 rps',
  );
  const flowRow = metrics.getByTestId('flow-table').getByRole('row', { name: /All traffic/ });
  await expect(flowRow.getByRole('button', { name: /^p99 of / })).toHaveText(/\d+(\.\d+)? ms/);

  // Overload the server: 400 000 users × 0.1 rps × peak 2 = 80 000 rps vs 10 000 rps capacity.
  await page.keyboard.press('Escape');
  const users = page.getByRole('spinbutton', { name: 'North America users' });
  await users.fill('400000');
  await users.press('Enter');
  await done(page);
  await expect(serverNode.getByTestId('component-node')).toHaveAttribute('data-level', 'hot');
  await expect(serverNode.getByLabel(/Utilisation \d+%, Overloaded/)).toBeVisible();
  await expect(metrics.getByRole('button', { name: 'Throughput: show formula' })).toHaveText(
    '80k rps',
  );

  // Bottleneck list → select + focus; detail panel with charts.
  const bottleneck = metrics
    .getByTestId('bottlenecks')
    .getByRole('button', { name: /app-server-1/ });
  await bottleneck.click();
  await expect(serverNode).toHaveClass(/selected/);
  const detail = metrics.getByTestId('node-detail');
  await expect(detail.getByRole('heading')).toHaveText('app-server-1');
  await expect(detail.getByRole('meter', { name: 'Utilisation' })).toHaveAttribute(
    'aria-valuetext',
    /Overloaded/,
  );
  await expect(detail.locator('.recharts-bar-rectangle')).toHaveCount(3);

  // "Show formula" tooltips come from SimResult.explain.
  await detail.getByRole('button', { name: 'Utilisation: show formula' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('ρ = λ/(c·μ)');
  await flowRow.getByRole('button', { name: /^p99 of / }).focus();
  await expect(page.getByRole('tooltip')).toContainText('shifted exponential');
  await page.keyboard.press('Escape');

  // Every number in the drawer is a formula button.
  const numbers = await metrics
    .locator('#metrics-drawer-body button')
    .evaluateAll((els) =>
      els
        .filter((e) => /\d/.test(e.textContent ?? '') && !e.closest('[data-testid="bottlenecks"]'))
        .map((e) => e.getAttribute('aria-label') ?? `MISSING: ${e.textContent}`),
    );
  expect(numbers.length).toBeGreaterThanOrEqual(18); // 4 KPIs + 5 flow cells + 9 node-detail numbers
  for (const label of numbers) expect(label).toMatch(/: show formula$/);

  // Run re-simulates on demand.
  await metrics.getByRole('button', { name: 'Run' }).click();
  await done(page);

  expect(errors).toEqual([]);
});
