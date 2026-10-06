import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('home lists teams', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Parklands Pumas/ })).toBeVisible();
});

test('unknown team shows Team not found', async ({ page }) => {
  await page.goto('/pumaz');
  await expect(page.getByRole('heading', { name: 'Team not found' })).toBeVisible();
});

test('a PlayHQ-scored game is prefilled', async ({ page }) => {
  await page.goto('/Pumas');
  await expect(page.locator('#game')).toHaveValue('e2e-g2'); // most recent played game
  await expect(page.locator('#team-runs')).toHaveValue('145');
  await expect(page.locator('#team-runs')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('No', { exact: true })).toHaveCount(0);
  await expect(page.getByText("Couldn't match to squad — please check.")).toBeVisible();
  await expect(page.getByRole('option', { name: 'Riccarton Rams', exact: false })).toHaveAttribute('disabled', '');
});

test('pairs games explain the limits and flag over-share milestones', async ({ page }) => {
  await page.goto('/pumas?game=e2e-g2');
  await expect(page.getByText('How are these worked out?')).toBeVisible();
  await expect(page.getByText("25 or more runs from the batter's first 12 balls.")).toBeVisible();
  await expect(page.getByText('⚠ Bowled 3 overs. Only wickets in the first 2 count. Check the scorebook.')).toBeVisible();
  await expect(page.getByText(/Faced \d+ balls/)).toHaveCount(0); // Alex faced exactly 12
  const tick = page.getByLabel('Checked: 3 wickets by the end of the 2nd over');
  await tick.check();
  await expect(tick).toBeChecked();
});

test('submit once, view read-only without full names, then edit', async ({ page }) => {
  await page.goto('/pumas?game=e2e-g1');
  await page.getByLabel('No', { exact: true }).check();
  await page.locator('#team-wkts').fill('5');
  await page.locator('#team-runs').fill('100');
  await page.locator('#opp-wkts').fill('7');
  await page.locator('#opp-runs').fill('9a0'); // non-digits are dropped
  await expect(page.locator('#opp-runs')).toHaveValue('90');
  await page.locator('#potd').selectOption({ label: 'Alex T.' });
  await page.locator('#mascot').selectOption('other');
  await page.locator('#mascot-other').fill('Chris Pratt');
  await page.getByRole('button', { name: 'Next: review' }).click();

  await expect(page.getByRole('heading', { name: 'Check your report' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).dblclick(); // double-tap must save once
  await expect(page.getByText('Thanks — report saved.')).toBeVisible();
  await expect(page.getByText('updated by someone else')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Chris P.')).toBeVisible();
  expect(await page.content()).not.toContain('Pratt');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#highlights').fill('Great catch by the keeper');
  await page.getByRole('button', { name: 'Next: review' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Great catch by the keeper')).toBeVisible();
});

test('validation errors show next to the questions', async ({ page }) => {
  await page.goto('/pumas?game=e2e-g2');
  await page.getByRole('button', { name: 'Next: review' }).click();
  await expect(page.getByText('Choose a player.').first()).toBeVisible();
});

test('all games marks the unreported past game as Missing', async ({ page }) => {
  await page.goto('/games');
  await expect(page.locator('tr.missing')).toContainText('Syd Martin Scorchers');
  await expect(page.locator('tr', { hasText: 'Hornby Hawks' })).toContainText('Reported');
  await expect(page.locator('tr', { hasText: 'Riccarton Rams' })).toContainText('Upcoming');
});
