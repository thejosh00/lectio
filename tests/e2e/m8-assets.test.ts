/**
 * M8, part one: assets and the image block. An asset is stored by content, typed by its
 * bytes, capped in size, served so the browser can't be talked into running it, and a
 * lesson may only show an image that exists.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {copyNewAssets} from '../../src/db/backup.ts';
import {ownershipLesson, rustSubject, startRun, submitLesson} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const TUTOR = {as: 'agent:tutor'};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sha256 = (data: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(data).digest('hex');

function binaryFile(name: string, data: Uint8Array): string {
  const path = join(lc.dir, name);
  Bun.write(path, data);
  return path;
}

test('asset put stores an image by the sha256 of its bytes, once', async () => {
  const put = await lc.j(['asset', 'put', lc.file('move.svg', SVG)], TUTOR);
  expect(put.code).toBe(0);
  expect(put.json).toMatchObject({ok: true, existing: false, asset: {id: sha256(SVG), mime: 'image/svg+xml', bytes: SVG.length, added_by: 'agent:tutor'}});
  expect(existsSync(join(lc.dir, 'assets', `${sha256(SVG)}.svg`))).toBe(true);

  // The same bytes under another name are the same asset.
  const again = await lc.j(['asset', 'put', lc.file('other-name.txt', SVG)], TUTOR);
  expect(again.json).toMatchObject({ok: true, existing: true, asset: {id: sha256(SVG), added_by: 'agent:tutor'}});
  expect((lc.db.query('SELECT COUNT(*) AS n FROM assets').get() as {n: number}).n).toBe(1);

  const png = await lc.j(['asset', 'put', binaryFile('dot.png', PNG)]);
  expect(png.json).toMatchObject({ok: true, asset: {id: sha256(PNG), mime: 'image/png', bytes: PNG.length, added_by: 'you'}});
  expect((await lc.cli(['asset', 'put', binaryFile('dot2.png', PNG)])).stdout).toBe(`already stored: ${sha256(PNG)} (image/png, ${PNG.length} bytes)`);

  // Where the backup looks for them.
  expect(copyNewAssets(lc.dir)).toBe(2);
  expect(readdirSync(join(lc.dir, 'backups', 'assets')).sort()).toEqual([`${sha256(PNG)}.png`, `${sha256(SVG)}.svg`].sort());
});

test('the type comes from the bytes, never the name, and the size is capped', async () => {
  const text = await lc.j(['asset', 'put', lc.file('photo.png', 'not a picture at all')], TUTOR);
  expect(text.code).toBe(2);
  expect(text.json.error).toContain('not a PNG, JPEG, GIF, WebP or SVG');
  const html = await lc.j(['asset', 'put', lc.file('page.svg', '<html><svg/></html>')], TUTOR);
  expect(html.code).toBe(2);

  await lc.j(['settings', 'set', 'asset_max_bytes', '1000']);
  const big = await lc.j(['asset', 'put', lc.file('big.svg', `<svg>${' '.repeat(1000)}</svg>`)], TUTOR);
  expect(big.code).toBe(2);
  expect(big.json.error).toContain('the limit is 1000 (asset_max_bytes)');
  expect((await lc.j(['asset', 'put', lc.file('fits.svg', SVG)], TUTOR)).code).toBe(0);

  const missing = await lc.j(['asset', 'put', join(lc.dir, 'nope.svg')], TUTOR);
  expect(missing.code).toBe(2);
  expect(lc.db.query('SELECT id FROM assets').all()).toHaveLength(1);
});

test('the builder may not put assets', async () => {
  const builder = await lc.j(['asset', 'put', lc.file('move.svg', SVG)], {as: 'agent:builder'});
  expect(builder.code).toBe(2);
  expect(builder.json.error).toContain('Adding assets');
});

test('assets are served with their sniffed type, nosniff, a locked-down CSP and a long cache', async () => {
  const id = (await lc.j(['asset', 'put', lc.file('x.svg', SVG)], TUTOR)).json.asset.id as string;
  const auth = {headers: {authorization: `Bearer ${lc.token('you')}`}};
  for (const path of [`/assets/${id}`, `/assets/${id}.svg`]) {
    const response = await fetch(`${lc.url}${path}`, auth);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(await response.text()).toBe(SVG);
  }
  const png = (await lc.j(['asset', 'put', binaryFile('dot.png', PNG)])).json.asset.id as string;
  const served = await fetch(`${lc.url}/assets/${png}`, auth);
  expect(served.headers.get('content-type')).toBe('image/png');
  expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array(PNG));

  expect((await fetch(`${lc.url}/assets/${id}`)).status).toBe(401);
  expect((await fetch(`${lc.url}/assets/${'0'.repeat(64)}`, auth)).status).toBe(404);
  expect((await fetch(`${lc.url}/assets/..%2Flectio.db`, auth)).status).toBe(404);
});

test('a lesson may show an image only of an asset that exists, with an alt', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const id = (await lc.j(['asset', 'put', lc.file('x.svg', SVG)], TUTOR)).json.asset.id as string;
  const withImage = (body: Record<string, unknown>) => {
    const lesson = ownershipLesson();
    return {...lesson, blocks: [...lesson.blocks, {type: 'image', approach: 'visual', concepts: ['ownership'], body}]};
  };

  const missing = await submitLesson(lc, subject, run, withImage({asset: sha256('nothing'), alt: 'a box'}));
  expect(missing.code).toBe(2);
  expect(missing.json.errors).toContainEqual({path: 'blocks[4].body.asset', message: expect.stringContaining('asset put')});
  const noAlt = await submitLesson(lc, subject, run, withImage({asset: id, alt: ' '}));
  expect(noAlt.json.errors).toEqual([{path: 'blocks[4].body.alt', message: 'must not be empty'}]);

  const ok = await submitLesson(lc, subject, run, withImage({asset: id, alt: 'one owner, one buffer', caption: 'After the move'}));
  expect(ok.code).toBe(0);
  const shown = await lc.cli(['lesson', 'show', ok.json.lesson.id]);
  expect(shown.stdout).toContain('[image] one owner, one buffer');
  const blocks = (await lc.j(['lesson', 'show', ok.json.lesson.id])).json.lesson.blocks;
  expect(blocks[4]).toMatchObject({type: 'image', body: {asset: id, alt: 'one owner, one buffer', caption: 'After the move'}});
});
