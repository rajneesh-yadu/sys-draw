import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * F8: moving 40% of users to Asia (India) with servers only in us-east raises their p50 by roughly
 * the trans-Pacific/Indian-Ocean RTT; adding an ap-south region (geo-DNS: nearest region) fixes it.
 */
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

const nodeIds = (page: Page) =>
  page
    .locator('.react-flow__node-component')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));

/** Select two nodes, wrap them in a Region group and set its cloud region in the inspector. */
async function regionOf(page: Page, a: string, b: string, regionId: string) {
  const groups = page.getByTestId('group-node');
  const before = await groups.count();
  await page.locator(`.react-flow__node[data-id="${a}"]`).click();
  await page.locator(`.react-flow__node[data-id="${b}"]`).click({ modifiers: ['Shift'] });
  await page.locator('[data-group-kind="region"]').click();
  await expect(groups).toHaveCount(before + 1);
  // The new region group asks for a region; select it (header) to open its panel.
  const pick = page.getByTestId('group-region').filter({ hasText: 'Pick a region' });
  await expect(pick).toHaveCount(1);
  await pick.click();
  const region = page.getByRole('combobox', { name: /^Region/ });
  await region.selectOption(regionId);
  await expect(page.getByTestId('group-region').filter({ hasText: regionId })).toHaveCount(1);
}

async function ms(cell: Locator): Promise<number> {
  const t = (await cell.textContent()) ?? '';
  const m = /([\d.]+)\s*(ms|s)/.exec(t);
  if (!m) throw new Error(`not a duration: ${t}`);
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

test('F8: far users pay the RTT; a nearer region fixes it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Chromium asks for /favicon.ico late in long tests; the app has none (not an app error).
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text());
  });

  await page.goto('/');
  await drop(page, 'client.app', 120, 200);
  await drop(page, 'network.load-balancer', 420, 120);
  await drop(page, 'compute.app-server', 720, 120);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(3);
  const [client, lb, server] = (await nodeIds(page)) as [string, string, string];
  await connect(page, client, lb);
  await connect(page, lb, server);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await regionOf(page, lb, server, 'us-east');

  // 60% of users in North America, 40% in India (scenario editor: map + one input per region).
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ position: { x: 600, y: 600 } });
  const map = page.getByTestId('users-map');
  await expect(map).toBeVisible();
  await expect(
    map.locator('[data-testid="map-cloud-region"][data-region-id="us-east"]'),
  ).toHaveCount(1);
  const na = map.getByRole('spinbutton', { name: 'North America users' });
  await na.fill('6000');
  await na.press('Enter');
  await map.locator('[data-testid="map-user-region"][data-region-id="india"]').click();
  const india = map.getByRole('spinbutton', { name: 'India & South Asia users' });
  await expect(india).toBeFocused();
  await india.fill('4000');
  await india.press('Enter');
  await expect(map.getByText('40%')).toBeVisible();
  await done(page);

  const table = page.getByTestId('region-table');
  const row = (name: RegExp) => table.getByRole('row', { name });
  const naRow = row(/North America/);
  const inRow = row(/India/);
  await expect(inRow.getByRole('button', { name: /^From for / })).toHaveText('us-east');
  await expect(naRow.getByRole('button', { name: /^From for / })).toHaveText('us-east');
  const naP50 = await ms(naRow.getByRole('button', { name: /^p50 for / }));
  const inP50 = await ms(inRow.getByRole('button', { name: /^p50 for / }));
  // Model: India → us-east 218.2 ms vs North America → us-east 38.8 ms ⇒ +179 ms.
  expect(inP50 - naP50).toBeGreaterThan(150);
  expect(inP50 - naP50).toBeLessThan(210);
  await inRow.getByRole('button', { name: /^Network for / }).hover();
  await expect(page.getByRole('tooltip')).toContainText('km / 200 km/ms');

  // Add an ap-south region: its own LB + server, connected to the same client.
  await drop(page, 'network.load-balancer', 420, 420);
  await drop(page, 'compute.app-server', 720, 420);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(5);
  const ids = await nodeIds(page);
  const [lb2, server2] = ids.filter((i) => ![client, lb, server].includes(i)) as [string, string];
  await connect(page, client, lb2);
  await connect(page, lb2, server2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(4);
  await regionOf(page, lb2, server2, 'ap-south');
  await done(page);

  await expect(inRow.getByRole('button', { name: /^From for / })).toHaveText('ap-south');
  await expect(naRow.getByRole('button', { name: /^From for / })).toHaveText('us-east');
  const inP50After = await ms(inRow.getByRole('button', { name: /^p50 for / }));
  const naP50After = await ms(naRow.getByRole('button', { name: /^p50 for / }));
  expect(inP50 - inP50After).toBeGreaterThan(150);
  expect(Math.abs(inP50After - naP50After)).toBeLessThan(15);

  expect(errors).toEqual([]);
});
