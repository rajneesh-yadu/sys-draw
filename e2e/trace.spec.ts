import { expect, test, type Page } from '@playwright/test';

/**
 * S15 / F10 trace acceptance: "a trace animates DNS → TCP → TLS → HTTP for one request".
 * Client (North America users) → app server in us-east (RTT ≈ 38.8 ms, last mile 15 ms).
 * Cold: DNS, TCP SYN / SYN-ACK / ACK, TLS ClientHello / ServerHello / Finished, then the HTTP
 * request; each step moves a packet along the edge. Warm drops DNS and the handshakes:
 * cold − warm = DNS 15 ms + TCP 1 RTT + TLS 1 RTT.
 */
test.use({ viewport: { width: 1700, height: 1000 } });

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

const nodeIds = (page: Page) =>
  page
    .locator('.react-flow__node-component')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));

function ms(text: string | null): number {
  const m = /([\d.]+)\s*(ms|s)\b/.exec((text ?? '').trim());
  if (!m) throw new Error(`not a duration: ${text}`);
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

test('F10: a trace animates DNS → TCP → TLS → HTTP for one request', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text());
  });

  await page.goto('/');
  await drop(page, 'client.app', 120, 200);
  await drop(page, 'compute.app-server', 560, 160);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(2);
  const [client, server] = (await nodeIds(page)) as [string, string];
  await connect(page, client, server);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const edgeId = await page.locator('.react-flow__edge').first().getAttribute('data-id');

  // App server in us-east.
  await page.locator(`.react-flow__node[data-id="${server}"]`).click();
  await page.locator('[data-group-kind="region"]').click();
  const pick = page.getByTestId('group-region').filter({ hasText: 'Pick a region' });
  await pick.click();
  await page.getByRole('combobox', { name: /^Region/ }).selectOption('us-east');
  await expect(page.getByTestId('group-region').filter({ hasText: 'us-east' })).toHaveCount(1);

  // Open the trace (cold by default) for North America users.
  await page.getByRole('button', { name: 'Trace request' }).click();
  const panel = page.getByTestId('trace-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Users in').selectOption('north-america');
  const rows = panel.getByTestId('trace-row');
  await expect(rows.first()).toHaveAttribute('data-kind', 'dns');

  // Order: DNS → TCP → TLS → HTTP request.
  const labels = await rows.evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label') ?? ''),
  );
  const first = (re: RegExp) => labels.findIndex((l) => re.test(l));
  const iDns = first(/DNS Query/);
  const iSyn = first(/TCP SYN,/);
  const iHello = first(/TLS 1\.3 ClientHello/);
  const iReq = first(/HTTP\/\d(\.\d)? Read request/);
  expect(iDns).toBe(0);
  expect(iSyn).toBeGreaterThan(iDns);
  expect(iHello).toBeGreaterThan(iSyn);
  expect(iReq).toBeGreaterThan(iHello);

  // Step through: each network step animates a packet along the edge.
  const packet = page.getByTestId('trace-packet');
  const next = panel.getByRole('button', { name: 'Next step' });
  await next.click(); // DNS query: no edge
  await expect(panel.getByTestId('trace-step-detail')).toContainText('DNS');
  await expect(packet).toHaveCount(0);
  for (let i = 1; i <= iSyn; i++) await next.click();
  await expect(panel.getByTestId('trace-step-detail')).toContainText('SYN');
  await expect(packet).toHaveAttribute('data-edge-id', edgeId ?? '');
  await expect(packet).toHaveAttribute('data-direction', 'forward');
  await expect(packet).toHaveAttribute('data-category', 'tcp');
  await next.click(); // SYN-ACK travels back
  await expect(packet).toHaveAttribute('data-direction', 'back');
  await rows.nth(iHello).click();
  await expect(packet).toHaveAttribute('data-category', 'tls');
  await expect(panel.getByTestId('trace-step-detail')).toContainText('SNI');
  await rows.nth(iReq).click();
  await expect(packet).toHaveAttribute('data-category', 'network');
  await expect(panel.getByTestId('trace-step-detail')).toContainText('Port 443');
  // The packet really moves: its position changes during the animation.
  const box1 = await packet.locator('circle').boundingBox();
  await page.waitForTimeout(400);
  const box2 = await packet.locator('circle').boundingBox();
  expect(box1 && box2 && Math.hypot(box2.x - box1.x, box2.y - box1.y)).toBeGreaterThan(5);

  // Play runs to the end.
  await panel.getByRole('button', { name: 'Play' }).click();
  await expect(panel.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 30_000 });
  const n = await rows.count();
  await expect(panel.getByTestId('trace-position')).toContainText(`Step ${n} / ${n}`);

  // Where time goes: cold vs warm.
  const total = panel.getByTestId('trace-total');
  await expect(panel.getByTestId('trace-cat-dns')).toContainText('15 ms');
  await expect(panel.getByTestId('trace-cat-tcp')).toBeVisible();
  await expect(panel.getByTestId('trace-cat-tls')).toBeVisible();
  const cold = ms(await total.textContent());
  const rtt = ms(await panel.getByTestId('trace-cat-tcp').locator('td').nth(1).textContent());
  expect(rtt).toBeGreaterThan(35);
  expect(rtt).toBeLessThan(42);
  await panel.getByText('Warm', { exact: true }).click();
  await expect(panel.getByTestId('trace-cat-dns')).toHaveCount(0);
  await expect(panel.getByTestId('trace-cat-tcp')).toHaveCount(0);
  await expect(rows.first()).toHaveAttribute('data-kind', 'request');
  const warm = ms(await total.textContent());
  expect(Math.abs(cold - warm - (15 + 2 * rtt))).toBeLessThan(1.5);

  expect(errors).toEqual([]);
});
