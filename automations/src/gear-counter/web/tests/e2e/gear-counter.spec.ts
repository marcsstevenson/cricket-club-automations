import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const todayLabel = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric' })
  .format(new Date())
  .replace(/,/g, '');
const line = (page: Page, name: string) => page.locator('li.line', { has: page.getByText(name, { exact: true }) });

test('home lists the teams and the club pool', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Parklands Penguins/ })).toContainText('Kiwi Year 1');
  await expect(page.getByRole('link', { name: /Club pool/ })).toBeVisible();
  await page.getByRole('link', { name: /Parklands Penguins/ }).click();
  await expect(page.getByRole('heading', { name: 'Parklands Penguins' })).toBeVisible();
  await expect(page.locator('.team-band .team-meta')).toHaveText('Kiwi Year 1');
  await expect(page.locator('.team-band').getByRole('img', { name: 'yellow dot' })).toBeVisible();
});

test('a team starts with its Kit Spec at 0 and counts with + and −', async ({ page }) => {
  await page.goto('/penguins');
  await expect(page.locator('#stocktake option:checked')).toHaveText(todayLabel);
  await expect(page.locator('.progress')).toHaveText('0 of 14 lines complete · 64 items short');
  await expect(page.getByRole('heading', { name: 'Senior kit' })).toHaveCount(0);

  const bases = line(page, 'Black rubber bases');
  await expect(bases.getByRole('button', { name: 'One less Black rubber bases' })).toBeDisabled();
  await expect(bases.locator('.done')).toHaveCount(0);
  await expect(page.getByText(/short \d|\+\d+ over/)).toHaveCount(0);
  await bases.getByRole('button', { name: 'One more Black rubber bases' }).click();
  await expect(bases.locator('.qty')).toHaveText('1 / 1');
  await expect(bases.locator('.done')).toHaveText('✓');

  const tees = line(page, 'Yellow batting tee');
  for (let i = 0; i < 6; i++) await tees.getByRole('button', { name: 'One more Yellow batting tee' }).click();
  await expect(tees.locator('.qty')).toHaveText('6 / 5');
  await expect(tees.locator('.done')).toHaveCount(0);
  await tees.getByRole('button', { name: 'One less Yellow batting tee' }).click();
  await expect(tees.locator('.qty')).toHaveText('5 / 5');
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.reload();
  await expect(line(page, 'Black rubber bases').locator('.qty')).toHaveText('1 / 1');
  await expect(page.locator('.progress')).toHaveText('2 of 14 lines complete · 58 items short');
});

test('items can be added from the modal and removed while at 0', async ({ page }) => {
  await page.goto('/penguins');
  await page.getByRole('button', { name: '+ Add item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an item' });
  await expect(dialog.getByRole('button', { name: 'Black rubber bases' })).toHaveCount(0); // already on the list
  await dialog.getByLabel('Search').fill('S2 (soft');
  await dialog.getByRole('button', { name: 'Wooden bat S2 (softball)' }).click();
  await expect(dialog).toBeHidden();

  const bat = line(page, 'Wooden bat S2 (softball)');
  await expect(bat).toContainText('Added');
  await expect(bat.locator('.qty')).toHaveText('0');
  await bat.getByRole('button', { name: 'One more Wooden bat S2 (softball)' }).click();
  await expect(bat.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await bat.getByRole('button', { name: 'One less Wooden bat S2 (softball)' }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await bat.getByRole('button', { name: 'Remove Wooden bat S2 (softball)' }).click();
  await expect(bat).toHaveCount(0);
  await page.reload();
  await expect(line(page, 'Wooden bat S2 (softball)')).toHaveCount(0);
});

test('New (today) reopens today’s stocktake', async ({ page }) => {
  await page.goto('/penguins');
  await page.locator('#stocktake').selectOption('new');
  await expect(page).toHaveURL(/\?s=/);
  await expect(page.locator('#stocktake option')).toHaveText([todayLabel, 'New (today)']);
  await expect(line(page, 'Black rubber bases').locator('.qty')).toHaveText('1 / 1');
});

test('taps made offline sync when the signal returns', async ({ page, context }) => {
  await page.goto('/pumas');
  const helmets = line(page, 'J [53-54, age 7-10]');
  await expect(helmets.locator('.qty')).toHaveText('0 / 2');
  await context.setOffline(true);
  await helmets.getByRole('button', { name: /One more/ }).click();
  await helmets.getByRole('button', { name: /One more/ }).click();
  await expect(page.getByText('Offline — will sync')).toBeVisible();
  await expect(helmets.locator('.qty')).toHaveText('2 / 2');
  await context.setOffline(false);
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(line(page, 'J [53-54, age 7-10]').locator('.qty')).toHaveText('2 / 2');
});

test('the club pool lists every item with counts only', async ({ page }) => {
  await page.goto('/pool');
  await expect(page.getByRole('heading', { name: 'Club pool' })).toBeVisible();
  await expect(page.locator('li.line')).toHaveCount(62);
  await expect(page.locator('.progress')).toHaveText('0 items counted');
  const cones = line(page, 'Tall cones');
  await cones.getByRole('button', { name: 'One more Tall cones' }).click();
  await expect(cones.locator('.qty')).toHaveText('1');
  await expect(page.locator('.progress')).toHaveText('1 item counted');
});

test('an unknown team shows Team not found', async ({ page }) => {
  await page.goto('/pumaz');
  await expect(page.getByRole('heading', { name: 'Team not found' })).toBeVisible();
});
