import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const line = (page: Page, name: string) => page.locator('li.line', { has: page.getByText(name, { exact: true }) });

async function named(page: Page, path: string, name = 'Sam') {
  await page.goto(path);
  // Each test runs in a fresh browser, so the name is always asked for.
  const dialog = page.getByRole('dialog', { name: "What's your name?" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Your name').fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Counting as ${name}`)).toBeVisible();
}

test('home lists the teams and the club pool', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Parklands Penguins/ })).toContainText('Kiwi Year 1');
  await expect(page.getByRole('link', { name: /Club pool/ })).toBeVisible();
});

test('asks for a name before any change, and remembers it', async ({ page }) => {
  await page.goto('/penguins');
  const dialog = page.getByRole('dialog', { name: "What's your name?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible(); // can't be skipped
  await dialog.getByLabel('Your name').fill('Sam');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.reload();
  await expect(page.getByText('Counting as Sam')).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('+ and − change the level, grouped into one log entry', async ({ page }) => {
  await named(page, '/penguins');
  await expect(page.locator('.progress')).toHaveText('0 items in this bag');
  const tees = line(page, 'Yellow batting tee');
  await expect(tees.getByRole('button', { name: 'One less Yellow batting tee' })).toBeDisabled();
  for (let i = 0; i < 3; i++) await tees.getByRole('button', { name: 'One more Yellow batting tee' }).click();
  await tees.getByRole('button', { name: 'One less Yellow batting tee' }).click();
  await expect(tees.locator('.qty')).toHaveText('2');
  await expect(page.getByText('All changes saved')).toBeVisible();
  const log = page.locator('.log li');
  await expect(log).toHaveCount(1);
  await expect(log.first()).toContainText('Sam');
  await expect(log.first()).toContainText('Yellow batting tee +2');
  await page.reload();
  await expect(line(page, 'Yellow batting tee').locator('.qty')).toHaveText('2');
  await expect(page.locator('.progress')).toHaveText('2 items in this bag');
});

test('set count and move to another team show in both logs', async ({ page }) => {
  await named(page, '/pool');
  const cones = line(page, 'Tall cones');
  await cones.getByRole('button', { name: 'More for Tall cones' }).click();
  let dialog = page.getByRole('dialog', { name: 'Tall cones' });
  await dialog.getByRole('button', { name: 'Set count…' }).click();
  await dialog.getByLabel('Count').fill('10');
  await dialog.getByLabel('Note (optional)').fill('shed check');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Tall cones set to 10.')).toBeVisible();
  await expect(cones.locator('.qty')).toHaveText('10');
  await expect(page.locator('.log li').first()).toContainText('Set Tall cones 0 → 10 · “shed check”');

  await cones.getByRole('button', { name: 'More for Tall cones' }).click();
  dialog = page.getByRole('dialog', { name: 'Tall cones' });
  await dialog.getByRole('button', { name: 'Move…' }).click();
  await dialog.getByLabel('Move to').selectOption({ label: 'Parklands Pumas' });
  await dialog.getByLabel('How many').fill('4');
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByText('Moved 4 Tall cones to Parklands Pumas.')).toBeVisible();
  await expect(cones.locator('.qty')).toHaveText('6');
  await expect(page.locator('.log li').first()).toContainText('Moved 4 Tall cones to Parklands Pumas');

  await page.goto('/pumas');
  await expect(line(page, 'Tall cones').locator('.qty')).toHaveText('4');
  await expect(page.locator('.log li').first()).toContainText('Received 4 Tall cones from Club pool');
});

test('a move larger than the level is refused', async ({ page }) => {
  await named(page, '/pumas');
  await line(page, 'Tall cones').getByRole('button', { name: 'More for Tall cones' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tall cones' });
  await dialog.getByRole('button', { name: 'Move…' }).click();
  await dialog.getByLabel('Move to').selectOption({ label: 'Club pool' });
  await dialog.getByLabel('How many').evaluate((el: HTMLInputElement) => el.removeAttribute('max'));
  await dialog.getByLabel('How many').fill('9');
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Only 4 available.');
});

test('items can be added and removed while at 0', async ({ page }) => {
  await named(page, '/penguins');
  await page.getByRole('button', { name: '+ Add item' }).click();
  const add = page.getByRole('dialog', { name: 'Add an item' });
  await add.getByLabel('Search').fill('S2 (soft');
  await add.getByRole('button', { name: 'Wooden bat S2 (softball)' }).click();
  const bat = line(page, 'Wooden bat S2 (softball)');
  await expect(bat).toContainText('Added');
  await bat.getByRole('button', { name: 'Remove Wooden bat S2 (softball)' }).click();
  await expect(bat).toHaveCount(0);
});

test('taps made offline sync when the signal returns', async ({ page, context }) => {
  await named(page, '/wolves'); // Year 5 lists the J helmet (Year 3 does not)
  const helmets = line(page, 'J [53-54, age 7-10]');
  await expect(helmets.locator('.qty')).toHaveText('0');
  await context.setOffline(true);
  await helmets.getByRole('button', { name: /One more/ }).click();
  await helmets.getByRole('button', { name: /One more/ }).click();
  await expect(page.getByText('Offline — will sync')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(line(page, 'J [53-54, age 7-10]').locator('.qty')).toHaveText('2');
});

test('admin adds a pool, downloads CSVs and hides it', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Admin passcode').fill('e2e-passcode');
  await page.getByRole('button', { name: 'Continue' }).click();
  const form = page.getByRole('form', { name: 'Add a pool' });
  await form.getByLabel('Name').fill('Garage Shed');
  await form.getByRole('button', { name: 'Add pool' }).click();
  await expect(page.locator('[data-team="garage-shed"]')).toContainText('No changes');

  const club = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Club inventory (CSV)' }).click();
  expect(readFileSync(await (await club).path(), 'utf8').split('\r\n')[0]).toContain('Garage Shed');
  const log = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Full log (CSV)' }).click();
  const logCsv = readFileSync(await (await log).path(), 'utf8');
  expect(logCsv).toContain('Move in');
  expect(logCsv).toContain('shed check');
  const levels = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Parklands Pumas levels CSV' }).click();
  expect((await levels).suggestedFilename()).toMatch(/^pumas-levels-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.locator('[data-team="garage-shed"]').getByRole('button', { name: 'Hide' }).click();
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Garage Shed/ })).toHaveCount(0);
});

test('coming back to the page while offline keeps the counter', async ({ page, context }) => {
  await named(page, '/narwhals');
  const tees = line(page, 'Yellow batting tee');
  await tees.getByRole('button', { name: 'One more Yellow batting tee' }).click();
  await expect(page.locator('.log li')).toHaveCount(1);
  await context.setOffline(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: 'Parklands Narwhals' })).toBeVisible();
  await expect(tees.locator('.qty')).toHaveText('1');
  await context.setOffline(false);
});

test('a name containing | is recorded as typed', async ({ page }) => {
  await named(page, '/monkeys', 'Sam|Jo');
  await line(page, 'Yellow batting tee').getByRole('button', { name: 'One more Yellow batting tee' }).click();
  await expect(page.locator('.log li').first()).toContainText('Sam|Jo ·');
});

test('admin edits the catalogue and teams follow', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Admin passcode').fill('e2e-passcode');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('link', { name: /Edit items/ }).click();

  const addCategory = page.getByRole('form', { name: 'Add a category' });
  await addCategory.getByLabel('Add a category').fill('Training');
  await addCategory.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('status')).toHaveText('Added Training.');

  const addItem = page.getByRole('form', { name: 'Add an item' });
  await addItem.getByLabel('Name').fill('Rebound net');
  await addItem.getByLabel('Category').selectOption({ label: 'Training' });
  await addItem.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('status')).toHaveText('Added Rebound net.');

  const year3 = await page.locator('#spec-pick option', { hasText: /^Year 3 \(/ }).getAttribute('value');
  await page.locator('#spec-pick').selectOption(year3!);
  await page.getByLabel('Rebound net', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save Year 3' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved the Year 3 Kit Spec.');

  await named(page, '/tigers'); // Year 3
  const net = line(page, 'Rebound net');
  await expect(net.locator('.qty')).toHaveText('0');
  await net.getByRole('button', { name: 'One more Rebound net' }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.goto('/admin/items');
  await page.getByRole('button', { name: 'Retire Rebound net' }).click();
  await expect(page.getByRole('status')).toHaveText('Rebound net is retired.');

  await page.goto('/tigers');
  await expect(net).toContainText('Retired');
  await expect(net.locator('.qty')).toHaveText('1'); // still held, so still listed
  await net.getByRole('button', { name: 'One less Rebound net' }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await net.getByRole('button', { name: 'Remove Rebound net' }).click();
  await expect(net).toHaveCount(0);

  await page.goto('/admin');
  const club = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Club inventory (CSV)' }).click();
  expect(readFileSync(await (await club).path(), 'utf8')).not.toContain('Rebound net');
});

test('an unknown team shows Team not found', async ({ page }) => {
  await page.goto('/pumaz');
  await expect(page.getByRole('heading', { name: 'Team not found' })).toBeVisible();
});
