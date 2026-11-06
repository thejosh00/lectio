/**
 * What the main pages look like, against saved pictures, on the phone and the desktop people use.
 * The other checks can't see a page that is merely ugly. A change meant to alter one updates its
 * picture in the same commit (`bun run test:browser --update-snapshots`), and the diff shows it.
 */
import {expect, test} from './support.ts';

test.beforeEach(({}, info) => {
  test.skip(!['iphone-webkit', 'desktop-chromium'].includes(info.project.name), 'one phone and one desktop are enough to compare');
});

for (const [name, route] of [['today', '#/'], ['subjects', '#/subjects'], ['tutor', '#/tutor'], ['improvements', '#/improvements']] as const) {
  test(`${name} looks right`, async ({lectio, signedIn: page}) => {
    await lectio.seed('everything');
    await page.goto(`${lectio.url}/${route}`);
    await page.locator('main.content > *').first().waitFor();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot(`${name}.png`, {animations: 'disabled', maxDiffPixelRatio: 0.002});
  });
}

test('a lesson looks right', async ({lectio, signedIn: page}) => {
  const {lesson} = await lectio.seed('lesson');
  await page.goto(`${lectio.url}/#/lesson/${lesson}`);
  await page.getByRole('heading', {name: 'Ownership: who frees the memory'}).waitFor();
  await page.waitForTimeout(500);
  // Its answers are dealt in a random order.
  await expect(page).toHaveScreenshot('lesson.png', {animations: 'disabled', maxDiffPixelRatio: 0.002, mask: [page.locator('.options')]});
});
