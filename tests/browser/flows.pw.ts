/** What a person does with lectio, through the page, at every size. */
import type {Page} from '@playwright/test';
import {expect, nav, pageHolds, test} from './support.ts';

const sure = (page: Page) => page.getByRole('button', {name: 'Sure', exact: true}).first();
/** Today, loaded anew. Only once it has settled: a reload cancels what's in flight, and WebKit reports that as an error. */
async function freshToday(page: Page) {
  await nav(page).getByRole('link', {name: 'Today'}).click();
  await page.getByRole('heading', {name: 'Today', exact: true}).waitFor();
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByRole('heading', {name: 'Today', exact: true}).waitFor();
}

const pickOption = (page: Page, text: string) => page.locator('.option', {hasText: text}).first().click();

test('signing in: a bad token is refused and a good one works', async ({lectio, page, complaints}) => {
  await page.goto(lectio.url);
  await page.getByLabel('token').fill('lc_nope');
  const refused = page.waitForResponse(r => r.url().endsWith('/api/session'));
  await page.getByRole('button', {name: 'Sign in'}).click();
  expect((await refused).status()).toBeGreaterThanOrEqual(400);
  await expect(page.locator('.error')).toBeVisible();
  await page.getByLabel('token').fill(lectio.token);
  await page.getByRole('button', {name: 'Sign in'}).click();
  await expect(page.getByRole('heading', {name: 'Today'}).or(page.getByRole('heading', {name: 'What do you want to learn?'})).first()).toBeVisible();
  // A refused sign-in is the one complaint this test expects; so is the check that nobody is signed in.
  complaints.splice(0, complaints.length, ...complaints.filter(c => !/\/api\/(session|whoami)|status of 40[13]/.test(c)));
});

test('nav: every tab goes to its page and says so', async ({lectio, signedIn: page}) => {
  await lectio.seed('lesson');
  for (const [label, heading] of [['Subjects', 'Subjects'], ['Progress', null], ['Library', 'Library'], ['Tutor', 'Your tutor'], ['Today', 'Today']] as const) {
    await nav(page).getByRole('link', {name: label}).click();
    await expect(nav(page).locator('a.active')).toContainText(label);
    if (heading !== null) await expect(page.getByRole('heading', {name: heading, exact: true}).first()).toBeAttached();
  }
});

test('a first subject, added from an empty day', async ({lectio, signedIn: page}) => {
  await lectio.seed('empty');
  await page.goto(`${lectio.url}/#/`);
  await page.getByRole('link', {name: 'Add a subject'}).click();
  await page.getByPlaceholder('Rust, music theory, the AWS exam…').fill('Sailing');
  await page.getByPlaceholder('Read and change our Rus', {exact: false}).fill('Sail a dinghy alone');
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText('Sailing').first()).toBeVisible();
  await nav(page).getByRole('link', {name: 'Today'}).click();
  await expect(page.getByRole('heading', {name: 'Sailing'})).toBeVisible();
});

test('reading a lesson: a wrong answer says why, and finishing leads to the quiz', async ({lectio, signedIn: page}) => {
  const {lesson} = await lectio.seed('lesson');
  await page.goto(`${lectio.url}/#/`);
  await page.getByRole('link', {name: 'Read'}).click();
  await expect(page).toHaveURL(new RegExp(`#/lesson/${lesson}`));
  await expect(page.getByRole('heading', {name: 'Ownership: who frees the memory'})).toBeVisible();

  await expect(sure(page)).toBeDisabled();
  await pickOption(page, 'deep copy');
  await sure(page).click();
  await expect(page.locator('.verdict')).toBeVisible();
  await expect(page.getByText('Why not that one')).toBeVisible();
  await expect(page.getByText('Deep copies need')).toBeVisible();

  await page.getByRole('button', {name: 'Finish, then the quiz'}).click();
  await expect(page).toHaveURL(/#\/quiz\//);
});

test('reacting to a block reaches the tutor', async ({lectio, signedIn: page}) => {
  const {lesson} = await lectio.seed('lesson');
  await page.goto(`${lectio.url}/#/lesson/${lesson}`);
  await page.getByRole('button', {name: 'react to this block'}).first().click();
  await page.getByRole('button', {name: 'Ask', exact: false}).first().click();
  await page.getByPlaceholder('Your question').fill('Why one owner?');
  await page.locator('.small.primary').first().click();
  await expect(page.getByRole('status')).toBeVisible();
});

test('a lesson the tutor submits appears on an open page, without a reload', async ({lectio, signedIn: page}) => {
  await lectio.seed('lesson-later');
  await page.goto(`${lectio.url}/#/`);
  await expect(page.getByRole('heading', {name: 'Rust ownership'})).toBeVisible();
  await expect(page.getByText('Ownership: who frees the memory')).toHaveCount(0);
  await lectio.seed('lesson-now');
  await expect(page.getByText('Ownership: who frees the memory').first()).toBeVisible();
});

test('a review comes due days later, and practising it works', async ({lectio, signedIn: page}) => {
  const {quiz, lesson} = await lectio.seed('lesson');
  await page.goto(`${lectio.url}/#/lesson/${lesson}`);
  await pickOption(page, 'was moved');
  await sure(page).click();
  await expect(page.locator('.verdict')).toContainText('Right');
  await page.getByRole('button', {name: 'Finish, then the quiz'}).click();
  await expect(page).toHaveURL(new RegExp(quiz));
  // What counts for memory is the quiz, not the check in the lesson.
  await page.getByLabel('your answer').fill('owner');
  await sure(page).click();
  await expect(page.locator('.verdict')).toContainText('Right');
  await page.getByRole('button', {name: 'Next'}).click();
  await pickOption(page, 'owner goes out of scope');
  await sure(page).click();
  await page.getByRole('button', {name: 'Next'}).click();
  await page.getByLabel('your answer').fill('One owner, so drops are known.');
  await sure(page).click();
  await page.getByRole('button', {name: 'Got it'}).click();
  await page.getByRole('button', {name: 'See how you did'}).click();
  await expect(page.locator('.score-big')).toBeVisible();
  await lectio.advance({days: 21});
  await freshToday(page);
  await page.getByRole('button', {name: 'Practice'}).click();
  await expect(page).toHaveURL(/#\/quiz\//);
  await expect(page.locator('.question')).toBeVisible();
});

test('approving a proposal on the Improvements page clears it', async ({lectio, signedIn: page}) => {
  await lectio.seed('everything');
  await page.goto(`${lectio.url}/#/`);
  await page.locator('a.banner', {hasText: 'Improvement'}).click();
  await expect(page.getByRole('heading', {name: 'Improving lectio'})).toBeVisible();
  await page.getByRole('button', {name: 'Approve'}).click();
  await expect(page.getByRole('status')).toContainText('Approved #1');
  await freshToday(page);
  await expect(page.locator('a.banner', {hasText: 'Improvement'})).toHaveCount(0);
});

test('every question type can be answered through the page, and holds before and after', async ({lectio, signedIn: page}, testInfo) => {
  test.setTimeout(180_000);
  const {quiz, lesson} = await lectio.seed('everything');
  await page.goto(`${lectio.url}/#/lesson/${lesson}`);
  await page.getByRole('button', {name: /^Finish/}).click();
  await expect(page).toHaveURL(new RegExp(quiz));
  const next = page.getByRole('button', {name: /^(Next|See how you did)$/});
  const verdict = page.locator('.verdict');
  let n = 0;
  const holds = (when: string) => pageHolds(page, testInfo, `question-${n}-${when}`, {axeExclude: ['iframe']});
  const answerSure = async () => {
    n += 1;
    await holds('asked');
    await sure(page).click();
    await page.locator('.reveal').waitFor();
    await holds('revealed');
  };

  // multiple_choice
  await pickOption(page, 'One owner');
  await answerSure();
  await expect(verdict).toContainText('Right');
  await next.click();
  // multi_select
  await pickOption(page, 'String');
  await pickOption(page, 'Vec');
  await answerSure();
  await expect(verdict).toContainText('Right');
  await next.click();
  // numeric
  await page.getByLabel('your answer').fill('1');
  await answerSure();
  await expect(verdict).toContainText('Right');
  await next.click();
  // short_text
  await page.getByLabel('your answer').fill('owner');
  await answerSure();
  await expect(verdict).toContainText('Right');
  await next.click();
  // cloze
  await page.getByLabel('blank who').fill('owner');
  await answerSure();
  await expect(verdict).toContainText('Right');
  await next.click();
  // ordering: whatever order it was dealt, sort it with the arrows
  for (const text of ['Allocate', 'Move', 'Drop']) {
    const items = page.locator('.order-item');
    const wanted = ['Allocate', 'Move', 'Drop'].indexOf(text);
    for (;;) {
      const at = (await items.allInnerTexts()).findIndex(t => t.includes(text));
      if (at <= wanted) break;
      await items.nth(at).getByRole('button', {name: 'move up'}).click();
    }
  }
  await answerSure();
  await expect(verdict).toContainText('Right');
  await next.click();
  // matching
  await page.locator('.match-row', {hasText: 'Move'}).locator('select').selectOption({label: 'Takes ownership'});
  await page.locator('.match-row', {hasText: 'Borrow'}).locator('select').selectOption({label: 'Takes a reference'});
  await answerSure();
  await expect(verdict).toContainText('Right');
  await next.click();
  // free_response, graded by you
  await page.getByLabel('your answer').fill('The compiler knows where each owner ends.');
  await answerSure();
  await page.getByRole('button', {name: 'Got it'}).click();
  await expect(next).toBeEnabled();
  await next.click();
  // widget: answered inside its sandbox
  await page.frameLocator('iframe[sandbox]').getByRole('button', {name: 'Set it'}).click();
  await expect(page.getByText('Your answer is in')).toBeVisible();
  await answerSure();
  await expect(verdict).toContainText('Right');
  await next.click();

  await expect(page.locator('.score-big')).toHaveText('100%');
});

test('every block type draws', async ({lectio, signedIn: page}) => {
  const {lesson} = await lectio.seed('everything');
  await page.goto(`${lectio.url}/#/lesson/${lesson}`);
  await expect(page.getByRole('heading', {name: /^Every kind of block/})).toBeVisible();

  // Math and a wide table, in the markdown.
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.prose table').first()).toBeVisible();
  // A wide code line scrolls inside its own box.
  await expect(page.locator('pre').first()).toBeVisible();
  // A picture that loaded, and one with its alt text.
  const image = page.locator('img[alt="one pixel standing in for a photo"]');
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
  // Mermaid really drew, in both diagrams.
  for (const caption of ['From engine to wheels', 'A wide one']) {
    const figure = page.locator('.figure', {hasText: caption});
    await figure.scrollIntoViewIfNeeded();
    const drawn = figure.locator('img[src^="data:image/svg"]');
    await expect(drawn).toBeVisible();
    await expect.poll(() => drawn.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
  }

  // Steps: guess, then see the next frame, and back.
  const steps = page.locator('.steps');
  await steps.scrollIntoViewIfNeeded();
  await steps.getByRole('button', {name: 'Show me'}).click();
  await expect(steps.getByRole('button', {name: 'Step 2', exact: true})).toHaveAttribute('aria-current', /.+/);
  await steps.getByRole('button', {name: 'Back a step'}).click();
  await expect(steps.getByRole('button', {name: 'Step 1', exact: true})).toHaveAttribute('aria-current', /.+/);

  // An animation in its sandbox: it runs and finishes.
  const widget = page.locator('.widget-block').first();
  await widget.scrollIntoViewIfNeeded();
  await widget.getByRole('button', {name: 'Play', exact: true}).click();
  await expect(widget.getByRole('button', {name: 'Play again'})).toBeVisible();
});
