import { expect, test, type Page } from '@playwright/test';

/**
 * F4: switching a board's provider relabels generic nodes to provider products
 * (Object Storage → S3 / Cloud Storage / Blob Storage) and swaps their limits and prices.
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

test('F4: provider switch relabels nodes and swaps limits and prices', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Chromium asks for /favicon.ico late in long tests; the app has none (not an app error).
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text());
  });

  await page.goto('/');
  await drop(page, 'client.app', 120, 200);
  await drop(page, 'compute.app-server', 420, 200);
  await drop(page, 'storage.object', 720, 200);
  const nodes = page.locator('.react-flow__node-component');
  await expect(nodes).toHaveCount(3);
  const [client, server, bucket] = (await nodes.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-id') ?? ''),
  )) as [string, string, string];
  await connect(page, client, server);
  await connect(page, server, bucket);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // 30 000 users × 0.1 rps × peak 2 = 6 000 rps (3 000 on average) through server and bucket.
  await page.keyboard.press('Escape');
  const users = page.getByRole('spinbutton', { name: 'North America users' });
  await users.fill('30000');
  await users.press('Enter');
  await done(page);

  const serverNode = page.locator(`.react-flow__node[data-id="${server}"]`);
  const bucketNode = page.locator(`.react-flow__node[data-id="${bucket}"]`);
  const nodeCost = page
    .getByTestId('region-metrics')
    .getByTestId('node-detail')
    .getByRole('button', { name: 'Cost / month: show formula' });
  const provider = page.getByRole('combobox', { name: 'Cloud provider' });

  await expect(bucketNode.getByTitle('Object Storage', { exact: true })).toBeVisible();
  await expect(serverNode.getByTitle('App Server', { exact: true })).toBeVisible();
  // Generic: 3 000 rps × 2.628 M s × $0.40/M + 1 000 GB × $0.023 = $3,177
  await bucketNode.click();
  await expect(nodeCost).toHaveText('$3,177');
  await expect(page.getByTestId('provider-info')).toHaveCount(0);

  // → AWS: review, then switch.
  await provider.selectOption('aws');
  const dialog = page.getByRole('dialog', { name: 'Switch to AWS' });
  await expect(dialog.getByTestId('switch-renames')).toContainText('Object Storage → S3');
  await expect(dialog.getByTestId('switch-renames')).toContainText('App Server → EC2');
  await expect(dialog).toContainText('as of 2026-10-01');
  await dialog.getByRole('button', { name: 'Switch to AWS' }).click();
  await done(page);
  await expect(bucketNode.getByTitle('S3', { exact: true })).toBeVisible();
  await expect(serverNode.getByTitle('EC2', { exact: true })).toBeVisible();
  await expect(nodeCost).toHaveText('$3,177'); // S3: same list prices as generic
  await nodeCost.hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'AWS price table (us-east-1, as of 2026-10-01',
  );
  // Limits: 6 000 GET/s > 5 500 per prefix.
  const info = page.getByTestId('provider-info');
  const getLimit = info.locator('[data-limit-id="s3-prefix-reads"]');
  await expect(getLimit).toContainText('5,500 requests/s');
  await expect(getLimit).toContainText('Exceeded');
  await expect(page.getByTestId('region-metrics')).toContainText('AWS limit: GET/HEAD per prefix');
  // EC2 m7i.large: $0.1008 × 730 = $74 (generic small: $70)
  await serverNode.click();
  await expect(nodeCost).toHaveText('$74');

  // → Azure: Blob Storage, its own price and limit.
  await provider.selectOption('azure');
  await page
    .getByRole('dialog', { name: 'Switch to Azure' })
    .getByRole('button', { name: 'Switch to Azure' })
    .click();
  await done(page);
  await expect(bucketNode.getByTitle('Blob Storage', { exact: true })).toBeVisible();
  await expect(serverNode.getByTitle('Virtual Machines', { exact: true })).toBeVisible();
  await expect(nodeCost).toHaveText('$70'); // D2s v5 $0.096
  await bucketNode.click();
  // 3 000 × 2.628 M × $0.50/M + 1 000 GB × $0.018 = $3,960
  await expect(nodeCost).toHaveText('$3,960');
  await expect(info.locator('[data-limit-id="blob-account-rps"]')).toContainText(
    '20,000 requests/s',
  );
  await expect(info.locator('[data-limit-id="s3-prefix-reads"]')).toHaveCount(0);

  // → GCP: Cloud Storage at $0.020/GB-month.
  await provider.selectOption('gcp');
  await page
    .getByRole('dialog', { name: 'Switch to GCP' })
    .getByRole('button', { name: 'Switch to GCP' })
    .click();
  await done(page);
  await expect(bucketNode.getByTitle('Cloud Storage', { exact: true })).toBeVisible();
  await expect(nodeCost).toHaveText('$3,174');

  // One undo step goes back to Azure.
  await page.locator('.react-flow__pane').click({ position: { x: 50, y: 600 } });
  await page.keyboard.press('Control+z');
  await expect(provider).toHaveValue('azure');
  await expect(bucketNode.getByTitle('Blob Storage', { exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});
