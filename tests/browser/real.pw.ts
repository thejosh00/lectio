/** Your own lessons, from a copy of your newest backup, at phone and desktop size. `bun run test:real` */
import {pageHolds, test} from './support.ts';

test('every real lesson holds', async ({lectio, signedIn: page}, testInfo) => {
  test.setTimeout(30 * 60_000);
  const lessons = lectio.real!.lessons;
  console.log(`${testInfo.project.name}: ${lessons.length} lessons`);
  for (const [i, lesson] of lessons.entries()) {
    await page.goto(`${lectio.url}/#/lesson/${lesson}`);
    await page.locator('h1.lesson-title').waitFor();
    await page.waitForTimeout(300);
    await pageHolds(page, testInfo, `real-${i}-${lesson}`, {axeExclude: ['iframe']});
  }
});
