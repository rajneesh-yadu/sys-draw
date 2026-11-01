import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * S14 done-when: switching an edge from HTTP/1.1 to HTTP/2 to HTTP/3 changes cold-request latency
 * by the expected RTTs. Client (North America users) → reverse proxy in us-east: RTT ≈ 38.8 ms.
 * Cold request = (handshake RTTs + 1) × RTT: HTTP/1.1 = HTTP/2 = 3 RTT (TCP + TLS 1.3 + request),
 * HTTP/3 = 2 RTT (QUIC + request).
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

async function ms(cell: Locator): Promise<number> {
  const t = (await cell.textContent()) ?? '';
  const m = /([\d.]+)\s*(ms|s)$/.exec(t.trim());
  if (!m) throw new Error(`not a duration: ${t}`);
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

test('S14: HTTP/1.1 → HTTP/2 → HTTP/3 changes cold-request latency by the expected RTTs', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text());
  });

  await page.goto('/');
  await drop(page, 'client.app', 120, 200);
  await drop(page, 'network.reverse-proxy', 420, 120);
  await drop(page, 'compute.app-server', 720, 120);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(3);
  const [client, proxy, server] = (await nodeIds(page)) as [string, string, string];
  await connect(page, client, proxy);
  await connect(page, proxy, server);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // Put the proxy and server in us-east.
  const groups = page.getByTestId('group-node');
  await page.locator(`.react-flow__node[data-id="${proxy}"]`).click();
  await page.locator(`.react-flow__node[data-id="${server}"]`).click({ modifiers: ['Shift'] });
  await page.locator('[data-group-kind="region"]').click();
  await expect(groups).toHaveCount(1);
  const pick = page.getByTestId('group-region').filter({ hasText: 'Pick a region' });
  await expect(pick).toHaveCount(1);
  await pick.click();
  await page.getByRole('combobox', { name: /^Region/ }).selectOption('us-east');
  await expect(page.getByTestId('group-region').filter({ hasText: 'us-east' })).toHaveCount(1);
  await done(page);

  // Select the client → proxy edge (the first one drawn).
  await page
    .locator('.react-flow__edge')
    .first()
    .locator('.react-flow__edge-interaction')
    .click({ force: true });
  await expect(page.getByText('Connection', { exact: true })).toBeVisible();

  const picker = page.getByRole('combobox', { name: /Stack/ });
  const coldOf = async (stackValue: string) => {
    await page.getByRole('tab', { name: 'Settings' }).click();
    await picker.selectOption(stackValue);
    await page.waitForTimeout(500); // the run is debounced by 300 ms
    await done(page);
    await page.getByRole('tab', { name: 'Network' }).click();
    const table = page.getByRole('table', { name: 'Request latency by connection state' });
    const cell = (name: string) =>
      table
        .getByRole('row', { name: new RegExp(name) })
        .locator('td')
        .last();
    // Wait for the re-run (debounced) to land before reading.
    await expect(cell('New connection')).toHaveText(/\d ms$/);
    await expect(cell('Warm')).toHaveText(/\d ms$/);
    return { cold: await ms(cell('New connection')), warm: await ms(cell('Warm')) };
  };

  const h1 = await coldOf('tcp/tls13/http1');
  const h2 = await coldOf('tcp/tls13/http2');
  const h3 = await coldOf('udp/quic/http3');
  const rtt = h1.warm;
  expect(rtt).toBeGreaterThan(35);
  expect(rtt).toBeLessThan(42);
  expect(Math.abs(h1.cold - 3 * rtt)).toBeLessThan(1.5); // 3 RTT
  expect(Math.abs(h2.cold - h1.cold)).toBeLessThan(1); // HTTP/2: same handshakes as HTTP/1.1
  expect(Math.abs(h2.cold - h3.cold - rtt)).toBeLessThan(1.5); // HTTP/3 saves one RTT
  await expect(page.getByText('UDP 443 (HTTP/3 over TLS)')).toBeVisible();
  await expect(page.getByRole('list', { name: 'OSI layers' })).toContainText('QUIC');

  expect(errors).toEqual([]);
});
