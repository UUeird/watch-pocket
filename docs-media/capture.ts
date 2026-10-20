import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import type { Browser, Locator, Page } from '@playwright/test';

// Where the Docs pages find their media. Committed, so the site deploys with them; rerun `npm run docs:media` after
// a change to the charts and commit what changes.
export const out = 'public/docs/media';
mkdirSync(out, { recursive: true });

// Every capture is in the light scheme, at one window size, so the set reads as one.
export const viewport = { width: 1280, height: 800 };

// A still of one part of a page, at twice the pixels so it stays sharp on a dense screen.
// The site header sticks to the top of the window, so it is let go first, or it would cover what scrolls under it;
// and the mouse is moved off, so nothing shows its hover outline.
export async function still(target: Locator, name: string) {
  const page = target.page();
  await page.addStyleTag({ content: 'header { position: static !important; }' });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await target.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
}

// A recording has no pointer of its own, so the page draws one: a dot that follows the mouse and rings on a click.
// As for stills, the site header is let go so it doesn't cover what scrolls under it.
const pointer = () => {
  addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = 'header { position: static !important; }';
    document.head.append(style);
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;z-index:99999;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgb(28 27 25 / 0.55);border:2px solid #fff;box-shadow:0 1px 4px rgb(0 0 0 / 0.35);pointer-events:none;' +
      'transition:transform 120ms ease-out';
    document.body.append(dot);
    addEventListener('mousemove', (event) => {
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
    }, { capture: true });
    addEventListener('mousedown', () => (dot.style.transform = 'scale(0.7)'), { capture: true });
    addEventListener('mouseup', () => (dot.style.transform = ''), { capture: true });
  });
};

// Glides the mouse to the middle of `target`, slowly enough to follow.
export async function glide(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 });
  await page.waitForTimeout(250);
}

export async function glideAndClick(page: Page, target: Locator) {
  await glide(page, target);
  await page.mouse.down();
  await page.mouse.up();
}

// Records `steps` in a fresh window and saves it as `name`.mp4, with its first frame as `name`.jpg for a poster.
// `steps` calls `ready()` once the page has loaded and is in place; the recording is trimmed to start there, so it
// doesn't open on a blank window. Playwright records WebM with no index to seek by, so it's re-encoded as H.264,
// which every browser plays and can seek.
export async function record(browser: Browser, name: string, steps: (page: Page, ready: () => void) => Promise<void>, baseURL?: string) {
  const tmp = join(out, '.tmp', name);
  const context = await browser.newContext({ viewport, colorScheme: 'light', baseURL, recordVideo: { dir: tmp, size: viewport } });
  await context.addInitScript(pointer);
  const started = Date.now();
  let start = 0;
  const page = await context.newPage();
  await page.mouse.move(viewport.width / 2, viewport.height - 40);
  await steps(page, () => (start = (Date.now() - started) / 1000));
  await page.waitForTimeout(800);
  const video = page.video()!;
  await context.close();
  const mp4 = join(out, `${name}.mp4`);
  const run = (args: string[]) => execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  run(['-ss', start.toFixed(2), '-i', await video.path(), '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
  run(['-i', mp4, '-frames:v', '1', '-q:v', '3', join(out, `${name}.jpg`)]);
  rmSync(tmp, { recursive: true, force: true });
}
