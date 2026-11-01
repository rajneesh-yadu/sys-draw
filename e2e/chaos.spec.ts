import { expect, test, type Page } from '@playwright/test';

/**
 * S11 done-when, in the production build with the real worker:
 * - killing one AZ of a 2-AZ deployment shows a dip and recovery;
 * - killing the only DB shows an outage.
 */
test.use({ viewport: { width: 1600, height: 1100 } });

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

const ids = (page: Page) =>
  page
    .locator('.react-flow__node-component')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));

const done = (page: Page) =>
  expect(page.getByTestId('sim-status')).toHaveAttribute('data-status', 'done');

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Chromium asks for /favicon.ico; the app has none (not an app error).
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(m.text());
  });
  return errors;
}

async function setUsers(page: Page, n: number) {
  await page.keyboard.press('Escape');
  const users = page.getByRole('spinbutton', { name: 'North America users' });
  await users.fill(String(n));
  await users.press('Enter');
}

async function addEvent(page: Page, kind: string, target: { index: number }, atSec: number) {
  await page.getByRole('button', { name: 'Add chaos event…' }).click();
  const form = page.getByRole('form', { name: 'Add chaos event' });
  await form.getByLabel('Event').selectOption(kind);
  await form.getByLabel('Target').selectOption(target);
  await form.getByLabel('Starts at (s)').fill(String(atSec));
  await form.getByRole('button', { name: 'Add event' }).click();
}

async function scrubTo(page: Page, tick: number) {
  await page.getByLabel('Timeline position').fill(String(tick));
}

test('killing one AZ of a 2-AZ deployment: dip, then recovery', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await drop(page, 'client.app', 100, 220);
  await drop(page, 'network.load-balancer', 380, 220);
  await drop(page, 'compute.app-server', 720, 120);
  await drop(page, 'compute.app-server', 720, 360);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(4);
  const [client, lb, appA, appB] = (await ids(page)) as [string, string, string, string];
  await connect(page, client, lb);
  await connect(page, lb, appA);
  await connect(page, lb, appB);
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  // One app server per availability zone.
  for (const app of [appA, appB]) {
    await page.locator(`.react-flow__node[data-id="${app}"]`).click();
    await page.locator('[data-group-kind="az"]').click();
  }
  await expect(page.getByTestId('group-node')).toHaveCount(2);

  await setUsers(page, 10_000);
  await done(page);

  // Kill the first AZ at t = 20 s (LB health checks: 10 s × 3 ⇒ removed at 50 s).
  await addEvent(page, 'groupOutage', { index: 1 }, 20);
  await expect(page.getByTestId('chaos-events')).toContainText('down at 20 s until the end');
  await done(page);
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toBeVisible();
  await expect(timeline.getByRole('figure', { name: 'Availability' })).toBeVisible();
  await expect(page.getByTestId('timeline-markers')).toContainText(/stops sending to/);

  const readout = page.getByTestId('timeline-readout');
  await scrubTo(page, 10);
  await expect(readout).toContainText('t = 10 s');
  await expect(readout).toContainText('availability 100%');

  await scrubTo(page, 30);
  await expect(readout).toContainText('availability 50%');
  const nodeA = page.locator(`.react-flow__node[data-id="${appA}"] [data-testid="component-node"]`);
  await expect(nodeA).toHaveAttribute('data-state', 'down');
  await expect(
    page.locator(`.react-flow__node[data-id="${appA}"]`).getByText('Down'),
  ).toBeVisible();

  await scrubTo(page, 55);
  await expect(readout).toContainText('availability 100%');
  await expect(page.getByText('Warning: Dip and recovery')).toBeVisible();

  await page.getByRole('button', { name: 'Steady state' }).click();
  await expect(nodeA).not.toHaveAttribute('data-state', /.+/);
  expect(errors).toEqual([]);
});

test('killing the only database: outage', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await drop(page, 'client.app', 100, 220);
  await drop(page, 'compute.app-server', 420, 220);
  await drop(page, 'database.sql', 760, 220);
  await expect(page.locator('.react-flow__node-component')).toHaveCount(3);
  const [client, app, db] = (await ids(page)) as [string, string, string];
  await connect(page, client, app);
  await connect(page, app, db);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await setUsers(page, 1000);
  await done(page);

  // Options: 0 = "Choose…", then nodes in board order (client, app, db).
  await addEvent(page, 'nodeOutage', { index: 3 }, 15);
  await done(page);
  const readout = page.getByTestId('timeline-readout');
  await scrubTo(page, 30);
  await expect(readout).toContainText('availability 0%');
  await expect(
    page.locator(`.react-flow__node[data-id="${db}"] [data-testid="component-node"]`),
  ).toHaveAttribute('data-state', 'down');
  await expect(page.getByText('Error: Outage')).toBeVisible();
  // Play from the start: the readout advances on its own.
  await page.getByRole('button', { name: 'Play timeline' }).click();
  await expect(readout).toContainText(/t = [1-9]\d* s/);
  expect(errors).toEqual([]);
});
