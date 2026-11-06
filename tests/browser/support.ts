/**
 * The fixtures every browser test uses: its own lectio instance, a browser signed in to it, and a
 * failure for anything the page complains about, whether or not the test was looking.
 */
import AxeBuilder from '@axe-core/playwright';
import {test as base, expect, type Page} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

/** When every instance starts: the helpers' T0, so the page's clock and the server's agree. */
const T0 = '2026-09-12T15:00:00Z';

export interface Lectio {
  url: string;
  token: string;
  /** Put content in the instance: a name from seeds.ts. */
  seed(name: string): Promise<any>;
  /** Move the instance's clock. */
  advance(by: {days?: number; hours?: number; minutes?: number}): Promise<void>;
  /** A copy of your own data (`bun run test:real`): what's in it. */
  real?: {lessons: string[]};
}

export const test = base.extend<{lectio: Lectio; signedIn: Page; complaints: string[]}>({
  lectio: async ({}, use) => {
    const env: Record<string, string | undefined> = {...process.env, TZ: 'America/Chicago'};
    delete env['LECTIO_DIR'];
    delete env['LECTIO_TOKEN'];
    delete env['LECTIO_URL'];
    const child = spawn('bun', [join(import.meta.dirname, 'instance.ts')], {cwd: join(import.meta.dirname, '../..'), env, stdio: ['pipe', 'pipe', 'inherit']});
    const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
    const next = async () => JSON.parse((await lines.next()).value as string);
    const send = async (command: object) => {
      child.stdin.write(`${JSON.stringify(command)}\n`);
      const answer = await next();
      if (answer.error) throw new Error(answer.error);
      return answer.ok;
    };
    const {url, token, real} = await next();
    await use({url, token, real, seed: name => send({seed: name}), advance: async by => void (await send({advance: by}))});
    child.stdin.write(`${JSON.stringify({stop: true})}\n`);
    await new Promise(resolve => child.once('exit', resolve));
  },

  /** Console errors, uncaught exceptions and failed requests. Checked after every test, while the instance still runs. */
  complaints: [
    async ({page, lectio: _running}, use) => {
      const seen: string[] = [];
      page.on('pageerror', error => seen.push(`uncaught: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error') seen.push(`console: ${message.text()}`);
      });
      page.on('response', response => {
        if (response.status() >= 400) seen.push(`${response.status()} ${response.url()}`);
      });
      await use(seen);
      expect(seen, 'the page complained').toEqual([]);
    },
    {auto: true},
  ],

  signedIn: async ({page, lectio}, use) => {
    if (lectio.real === undefined) await page.clock.setFixedTime(new Date(T0));
    await page.goto(`${lectio.url}/?token=${lectio.token}`);
    await expect(page.locator('.tabs-top, .tabs-bottom').first()).toBeAttached();
    await use(page);
  },
});

/** The nav a person actually sees: the bottom bar on a phone, the top bar from tablet width. */
export const nav = (page: Page) => page.locator('.tabs-bottom:visible, .tabs-top:visible').first();

/** What has to be true of any page at any size. */
export async function pageHolds(page: Page, testInfo: {project: {name: string}}, name: string, options: {axeExclude?: string[]} = {}) {
  // Pictures draw when they scroll into view, and an empty box can't overflow: see them all first.
  const height = () => page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < (await height()); y += page.viewportSize()!.height / 2) {
    await page.evaluate(top => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => document.querySelectorAll('.diagram-loading').length === 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrolls = (e: Element) => {
      for (let p = e.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    const describe = (e: Element) => `${e.tagName.toLowerCase()}.${String(e.getAttribute('class') ?? '').slice(0, 40)} "${(e.textContent ?? '').trim().slice(0, 30)}"`;
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const cutOff = [...document.querySelectorAll('body *')]
      .filter(e => visible(e) && !scrolls(e) && !e.closest('svg, .katex') && (e.getBoundingClientRect().right > width + 1 || e.getBoundingClientRect().left < -1))
      .map(describe);
    const controls = [...document.querySelectorAll('a, button, input, select, textarea, summary')].filter(visible);
    const tooSmall = controls
      .filter(e => {
        const r = e.getBoundingClientRect();
        return (r.height < 24 || r.width < 24) && !e.closest('.prose, .katex, p, li');
      })
      .map(describe);
    const clipped = [...document.querySelectorAll('button, a, h1, h2, h3, label')]
      .filter(e => visible(e) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'hidden' && getComputedStyle(e).textOverflow !== 'ellipsis')
      .map(describe);
    // What reaches furthest, math and pictures included, so a sideways page says why.
    const widest = [...document.querySelectorAll('body *')]
      // KaTeX's hidden copy for screen readers measures wide, but it's clipped and widens nothing.
      .filter(e => visible(e) && !scrolls(e) && !e.closest('.katex-mathml') && e.getBoundingClientRect().right > width + 1)
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
      .slice(0, 3)
      .map(describe);
    return {sideways: document.documentElement.scrollWidth - width, widest, cutOff, tooSmall, clipped};
  });
  expect.soft(layout.sideways, `${name}: the page scrolls sideways, furthest: ${layout.widest.join(', ')}`).toBeLessThanOrEqual(0);
  expect.soft(layout.cutOff, `${name}: cut off at the screen's edge`).toEqual([]);
  expect.soft(layout.clipped, `${name}: text cut off inside its box`).toEqual([]);
  expect.soft(layout.tooSmall, `${name}: controls under 24px (WCAG 2.2 AA)`).toEqual([]);

  // Every nav item in view, the current page's included.
  const tabs = nav(page).locator('a');
  const box = page.viewportSize()!;
  for (let i = 0; i < (await tabs.count()); i++) {
    await expect.soft(tabs.nth(i)).toBeInViewport();
    const b = (await tabs.nth(i).boundingBox())!;
    expect.soft(b.x + b.width, `${name}: a nav item past the screen's edge`).toBeLessThanOrEqual(box.width);
  }

  let axe = new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  for (const selector of options.axeExclude ?? []) axe = axe.exclude(selector);
  const {violations} = await axe.analyze();
  const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  expect.soft(serious, `${name}: accessibility`).toEqual([]);

  const dir = join(import.meta.dirname, '../../.playwright/gallery', testInfo.project.name);
  mkdirSync(dir, {recursive: true});
  await page.screenshot({path: join(dir, `${name}.png`), fullPage: true});
}

export {expect};
