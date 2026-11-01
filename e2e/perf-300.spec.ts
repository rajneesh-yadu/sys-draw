import { expect, test, type Page } from '@playwright/test';

/**
 * S21 — non-functional budget (ARCHITECTURE.md): the canvas stays smooth with 300 nodes.
 *
 * Opens the 300-node fixture (`?fixture=perf-300`: 1 client → 4 LBs → 280 app servers → 5 Redis
 * + 10 Postgres, 844 connections), waits for the simulation, then measures frame rate with
 * requestAnimationFrame while dragging the view, wheel-zooming and clicking nodes.
 *
 * Thresholds: `PERF_MIN_FPS` (pan, default 30) and `PERF_MIN_FPS_INTERACT` (zoom / select,
 * default 20). Headless Chromium in CI rasterises in software on a couple of cores, so the
 * defaults guard against regressions there (S21 baseline in a 2-vCPU sandbox: pan 15 → 51 fps,
 * zoom 17 → 31, select 7 → 30). On a developer machine with a GPU run
 * `PERF_MIN_FPS=55 PERF_MIN_FPS_INTERACT=55 pnpm e2e perf-300` for the 60 fps check.
 */
test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ mode: 'serial' });

const MIN_PAN_FPS = Number(process.env.PERF_MIN_FPS ?? 30);
const MIN_INTERACT_FPS = Number(process.env.PERF_MIN_FPS_INTERACT ?? 20);

interface Frames {
  __frames: number[];
  __measuring: boolean;
}

async function startFrames(page: Page) {
  await page.evaluate(() => {
    // e2e is type-checked without the DOM lib; this runs in the page.
    const w = globalThis as unknown as Frames & {
      requestAnimationFrame(cb: (t: number) => void): number;
    };
    w.__frames = [];
    w.__measuring = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__measuring) w.requestAnimationFrame(tick);
    };
    w.requestAnimationFrame(tick);
  });
}

async function stopFrames(page: Page): Promise<{ fps: number; frames: number }> {
  const f = await page.evaluate(() => {
    const w = globalThis as unknown as Frames;
    w.__measuring = false;
    return w.__frames.slice(2);
  });
  const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
  return { fps: 1000 / avg, frames: f.length };
}

async function openFixture(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?fixture=perf-300');
  await expect(page.getByTestId('board-title')).toContainText('Perf · 300 nodes');
  await expect(page.locator('.react-flow__node-component')).toHaveCount(300);
  await expect(page.locator('.react-flow__edge')).toHaveCount(844);
  await expect(page.getByTestId('sim-status')).toHaveAttribute('data-status', 'done', {
    timeout: 20_000,
  });
  await page.waitForTimeout(500);
  return errors;
}

test('300-node fixture: loads, simulates, zoomed-out view uses low detail', async ({ page }) => {
  const errors = await openFixture(page);
  // Fit view shows everything at ~0.25×: nodes draw in low detail (border + label).
  await expect(page.locator('[data-lod="low"]').first()).toBeVisible();
  // The simulation ran in the worker well within budget (status text "Up to date (… ms|s)").
  await expect(page.getByTestId('sim-status')).toContainText('Up to date');
  expect(errors).toEqual([]);
});

test('300-node fixture: pan, zoom and select stay smooth', async ({ page }) => {
  await openFixture(page);
  const box = await page.getByTestId('board-canvas').boundingBox();
  if (!box) throw new Error('canvas not found');

  // Pan: drag empty space under the graph.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height - 60;
  await startFrames(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) await page.mouse.move(cx + Math.sin(i / 10) * 200, cy - 40);
  await page.mouse.up();
  const pan = await stopFrames(page);

  // Zoom: wheel in and out around the centre (crosses the low-detail threshold).
  await startFrames(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, i < 10 ? -100 : 100);
    await page.waitForTimeout(16);
  }
  const zoom = await stopFrames(page);

  // Select: click five different nodes.
  const nodes = page.locator('.react-flow__node-component');
  await startFrames(page);
  for (let i = 0; i < 5; i++) {
    const nb = await nodes.nth(20 + i * 9).boundingBox();
    if (nb) await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await page.waitForTimeout(50);
  }
  const select = await stopFrames(page);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);

  test.info().annotations.push({
    type: 'fps',
    description: `pan ${pan.fps.toFixed(1)} · zoom ${zoom.fps.toFixed(1)} · select ${select.fps.toFixed(1)}`,
  });
  console.log(
    `[perf-300] pan ${pan.fps.toFixed(1)} fps, zoom ${zoom.fps.toFixed(1)} fps, select ${select.fps.toFixed(1)} fps`,
  );
  expect(pan.fps).toBeGreaterThanOrEqual(MIN_PAN_FPS);
  expect(zoom.fps).toBeGreaterThanOrEqual(MIN_INTERACT_FPS);
  expect(select.fps).toBeGreaterThanOrEqual(MIN_INTERACT_FPS);
});
