import { expect, test, type Page } from '@playwright/test';

/** F6: doubling replicas behind an LB roughly halves utilisation; instance size changes capacity and cost. */
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

test('F6: +1 replica halves utilisation; size up raises capacity and cost', async ({ page }) => {
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

  // 30 000 users × 0.1 rps × peak 2 = 6 000 rps vs 10 000 rps on one small app server ⇒ 60 %.
  await page.keyboard.press('Escape');
  const users = page.getByRole('spinbutton', { name: 'North America users' });
  await users.fill('30000');
  await users.press('Enter');
  await done(page);
  const serverNode = page.locator(`.react-flow__node[data-id="${server}"]`);
  await expect(serverNode.getByLabel(/^Utilisation 60%/)).toBeVisible();
  const metrics = page.getByTestId('region-metrics');
  const cost = metrics
    .getByTestId('system-kpis')
    .getByRole('button', { name: 'Cost / month: show formula' });
  const nodeCost = metrics
    .getByTestId('node-detail')
    .getByRole('button', { name: 'Cost / month: show formula' });
  // LB $0.0225/h + small $0.096/h, × 730 h
  await expect(cost).toHaveText('$87');

  // Select the server and scale out from the inspector.
  await serverNode.click();
  const scale = page.getByRole('group', { name: 'Scale quick actions' });
  await scale.getByRole('button', { name: '+1 replica' }).click();
  await done(page);
  await expect(serverNode.getByLabel(/^Utilisation 30%/)).toBeVisible();
  await expect(cost).toHaveText('$157');
  await expect(nodeCost).toHaveText('$140'); // 2 × $0.096 × 730
  await nodeCost.hover();
  await expect(page.getByRole('tooltip')).toContainText('instances × $/h × 730');

  // Size up small → medium (2× vCPU, sublinear: μ × 1.82): 30 % → 16.5 % (shown 17 %), price × 2.
  await scale.getByRole('button', { name: 'Size up' }).click();
  await done(page);
  await expect(serverNode.getByLabel(/^Utilisation 17%/)).toBeVisible();
  await expect(cost).toHaveText('$297');
  await expect(nodeCost).toHaveText('$280');

  // Not every action applies: an app server has no read replicas.
  await expect(scale.getByRole('button', { name: 'Add read replica' })).toBeDisabled();

  expect(errors).toEqual([]);
});
