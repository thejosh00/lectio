/** Every page, in both themes, at every size: nothing cut off, nothing inaccessible, nothing complaining. */
import {pageHolds, test} from './support.ts';

const PAGES: Array<[string, (seeded: {subject: string; lesson: string; quiz: string}) => string]> = [
  ['today', () => '#/'],
  ['subjects', () => '#/subjects'],
  ['new-subject', () => '#/subjects/new'],
  ['subject', s => `#/subject/${s.subject}`],
  ['progress', () => '#/progress'],
  ['library', () => '#/library'],
  ['tutor', () => '#/tutor'],
  ['improvements', () => '#/improvements'],
  ['lesson', s => `#/lesson/${s.lesson}`],
  // A quiz's questions get the same checks, one by one, in flows.pw.ts.
  ['quiz-not-yet', s => `#/quiz/${s.quiz}`],
];

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(colorScheme, () => {
    test.use({colorScheme});
    for (const [name, route] of PAGES) {
      test(`${name} holds`, async ({lectio, signedIn: page}, testInfo) => {
        const seeded = await lectio.seed('everything');
        await page.goto(`${lectio.url}/${route(seeded)}`);
        await page.locator('main.content > *').first().waitFor();
        await page.waitForTimeout(500);
        // A widget's document is the tutor's own, in a sandbox; what surrounds it is ours.
        await pageHolds(page, testInfo, `${name}-${colorScheme}`, {axeExclude: ['iframe']});
      });
    }
    test('an empty first day holds', async ({lectio, signedIn: page}, testInfo) => {
      await lectio.seed('empty');
      await page.goto(`${lectio.url}/#/`);
      await page.getByRole('heading', {name: 'What do you want to learn?'}).waitFor();
      await pageHolds(page, testInfo, `first-day-${colorScheme}`);
    });
  });
}
