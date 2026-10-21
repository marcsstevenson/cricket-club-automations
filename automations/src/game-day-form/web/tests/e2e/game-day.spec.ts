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
  await expect(page.getByRole('option', { name: 'Riccarton Rams', exact: false })).not.toHaveAttribute('disabled');
});

test('an upcoming game can be filled in and reviewed but not saved', async ({ page }) => {
  await page.goto('/pumas');
  await page.locator('#game').selectOption('e2e-g3');
  const note = /Trying it out\? You can fill this in now and save it from \w{3} \d{1,2} \w{3}\./;
  await expect(page.getByText(note)).toBeVisible();
  await page.getByLabel('No', { exact: true }).check();
  await page.locator('#team-wkts').fill('5');
  await page.locator('#team-runs').fill('100');
  await page.locator('#opp-wkts').fill('7');
  await page.locator('#opp-runs').fill('90');
  await page.locator('#potd').selectOption({ label: 'Alex T. (0)' });
  await page.locator('#mascot').selectOption({ label: 'Jordan L. (0)' });
  await page.getByRole('button', { name: 'Next: review' }).click();
  await expect(page.getByRole('heading', { name: 'Check your report' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
  await expect(page.getByText(/You can save this report from \w{3} \d{1,2} \w{3}\./)).toBeVisible();
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
  await page.locator('#potd').selectOption({ label: 'Alex T. (0)' });
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
  await expect(page.locator('#potd option:checked')).toHaveText('Alex T. (0)'); // this game's own win isn't counted
  await page.locator('#highlights').fill('Great catch by the keeper');
  await page.getByRole('button', { name: 'Next: review' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Great catch by the keeper')).toBeVisible();
});

test("award pickers show each player's earlier wins this season", async ({ page }) => {
  await page.goto('/pumas?game=e2e-g2');
  await expect(page.locator('#potd option', { hasText: 'Alex T.' })).toHaveText('Alex T. (1)');
  await expect(page.locator('#mascot option', { hasText: 'Alex T.' })).toHaveText('Alex T. (0)'); // mascot went to "Other"

  await page.getByRole('button', { name: 'Player of the day winners' }).click();
  const dialog = page.getByRole('dialog', { name: 'Player of the day — this season' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.winners li')).toHaveCount(1);
  await expect(dialog.locator('.winners li')).toContainText('Alex T.');
  await expect(dialog.locator('.win-counts tbody td:first-child')).toHaveText(['Jordan L.', 'Sam Ta.', 'Sam Th.', 'Alex T.']);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Mascot of the day winners' }).click();
  await expect(page.getByRole('dialog', { name: 'Mascot of the day — this season' }).getByText('No winners yet this season.')).toBeVisible();
});

test('validation errors show next to the questions', async ({ page }) => {
  await page.goto('/pumas?game=e2e-g2');
  await page.getByRole('button', { name: 'Next: review' }).click();
  await expect(page.getByText('Choose a player.').first()).toBeVisible();
});

test('All games and Admin menu items appear only after the admin passcode is accepted', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('.site-header nav');
  await expect(nav).toHaveCount(0);
  await expect(page.getByRole('link', { name: /See all games/ })).toHaveCount(0);

  await page.goto('/admin');
  await page.getByLabel('Admin passcode').fill('wrong');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong passcode.');
  await expect(nav).toHaveCount(0);

  await page.getByLabel('Admin passcode').fill('e2e-pass');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(nav.getByRole('link', { name: 'All games' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admin' })).toBeVisible();

  await nav.getByRole('link', { name: 'All games' }).click();
  await expect(page).toHaveURL(/\/games$/);
  await page.reload();
  await expect(nav.getByRole('link', { name: 'Admin' })).toBeVisible();
});

test('all games marks the unreported past game as Missing', async ({ page }) => {
  await page.goto('/games');
  await page.getByLabel('Day').selectOption({ label: 'All days' });
  await expect(page.locator('.game-card.missing')).toContainText('Syd Martin Scorchers');
  await expect(page.locator('.game-card', { hasText: 'Hornby Hawks' })).toContainText('Reported');
  await expect(page.locator('.game-card', { hasText: 'Riccarton Rams' })).toContainText('Upcoming');
});

test('all games filters by several teams and PlayHQ scoring, remembered except the day', async ({ page }) => {
  await page.goto('/games');
  const teams = page.locator('.multi');
  await expect(teams.locator('summary')).toHaveText('All teams');
  await teams.locator('summary').click();
  await teams.getByLabel('Parklands Tigers').check();
  await expect(teams.locator('summary')).toHaveText('Parklands Tigers');
  await expect(page.locator('.game-card')).toHaveCount(0); // Tigers have no games
  await teams.getByLabel('Parklands Pumas').check();
  await expect(teams.locator('summary')).toHaveText('Parklands Pumas, Parklands Tigers');
  await page.locator('h1').click(); // clicking elsewhere closes the list
  await expect(teams.getByLabel('Parklands Pumas')).toBeHidden();

  await page.getByLabel('PlayHQ scoring').selectOption({ label: 'No' });
  await page.getByLabel('Missing').check();
  await page.getByLabel('Day').selectOption({ label: 'All days' });
  await expect(page.locator('.game-card')).toHaveCount(0); // a reported game can't be Missing
  await page.getByLabel('Missing').uncheck();
  await page.getByLabel('Reported').check();
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.locator('.game-card')).toContainText('Hornby Hawks');
  await expect(page.getByRole('link', { name: 'Export games' })).toHaveAttribute('href', /team=pumas%2Ctigers.*scoring=no/);

  await page.reload();
  await expect(teams.locator('summary')).toHaveText('Parklands Pumas, Parklands Tigers');
  await expect(page.getByLabel('PlayHQ scoring')).toHaveValue('no');
  await expect(page.getByLabel('Reported')).toBeChecked();
  await expect(page.getByLabel('Day')).not.toHaveValue(''); // the day isn't remembered: back to the last game day
  await expect(page.locator('.game-card')).toContainText('Hornby Hawks');

  await teams.locator('summary').click();
  await teams.getByRole('button', { name: 'All teams' }).click();
  await expect(teams.locator('summary')).toHaveText('All teams');
});

test('all games waits for a pause in filter changes before reloading', async ({ page }) => {
  await page.goto('/games');
  await expect(page.locator('.game-card').first()).toBeVisible();
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/games')) calls.push(r.url());
  });
  await page.locator('.multi summary').click();
  await page.locator('.multi').getByLabel('Parklands Pumas').check();
  await page.locator('.multi').getByLabel('Parklands Tigers').check();
  await page.getByLabel('Reported').check();
  await expect.poll(() => calls.length).toBe(1);
  await page.waitForTimeout(800);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatch(/team=pumas%2Ctigers&status=reported/);
});

test('all games shows a loading animation, then opens on the last game day', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/games**', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/games');
  await expect(page.getByRole('status')).toContainText('Loading games');
  release();
  await expect(page.getByRole('status')).toHaveCount(0);

  const day = page.getByLabel('Day');
  await expect(day.locator('option')).toHaveCount(4); // All days + three game days
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.locator('.game-card')).toContainText('Syd Martin Scorchers'); // last day on or before today
  await expect(page.getByRole('link', { name: 'Export games' })).toHaveAttribute('href', /date=\d{4}-\d{2}-\d{2}/);

  await day.selectOption({ index: 1 }); // the earliest day
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.locator('.game-card')).toContainText('Hornby Hawks');
  await expect(page.locator('.game-card')).toContainText('PlayHQ scoring');

  await day.selectOption({ label: 'All days' });
  await expect(page.locator('.game-card')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Export games' })).not.toHaveAttribute('href', /date=/);
});
