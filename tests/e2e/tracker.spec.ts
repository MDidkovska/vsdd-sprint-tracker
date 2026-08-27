import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './support/auth';

// The mock auth client resets to anonymous on every page load, so each test
// signs in AFTER navigating to '/'. Team Update tests use lead@vsdd.test
// (TEAM_LEAD → Team Update tab); Leadership View tests use auditor@vsdd.test
// (AUDITOR → Leadership View tab, read-only). No account exposes both tabs.
test.describe('VSDD Sprint Tracker — Phase A · Team Update', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.lead);
  });

  test('loads the Team Update view with the four goal fields and three RAG selectors', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Week 1 update');
    await expect(page.getByRole('textbox', { name: /Business goal/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Technical \/ testing goal/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Sprint commitment/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Next week commitment/ })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Business outcome' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Test delivery' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Release confidence' })).toBeVisible();
  });

  test('edits an editable draft and autosaves', async ({ page }) => {
    // mmm-a Week 2 is an editable draft.
    await page.getByLabel('Current update').selectOption('2');
    const businessGoal = page.getByRole('textbox', { name: /Business goal/ });
    await expect(businessGoal).toBeEnabled();
    await businessGoal.fill('Updated business goal for the e2e run.');
    await expect(page.getByText(/Draft saved/).first()).toBeVisible({ timeout: 5000 });
  });

  test('submits an empty Missing draft is blocked with an error summary', async ({ page }) => {
    await page.getByLabel('Team', { exact: true }).selectOption('mmm-b');
    await page.getByLabel('Current update').selectOption('2');
    await expect(page.getByRole('textbox', { name: /Business goal/ })).toHaveValue('');
    await page.getByRole('button', { name: 'Submit update' }).click();
    await expect(page.getByText('Fix these before submitting')).toBeVisible();
  });

  test('shows read-only access for an unassigned team', async ({ page }) => {
    await page.getByLabel('Stream', { exact: true }).selectOption('O24');
    await page.getByLabel('Team', { exact: true }).selectOption('o24-desktop');
    await expect(page.getByText(/read-only access to this team/)).toBeVisible();
  });
});

test.describe('VSDD Sprint Tracker — Phase A · Leadership View', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.auditor);
  });

  test('leadership drill-down shows the same submitted values under the hierarchy path', async ({ page }) => {
    await page.getByRole('tab', { name: 'Leadership View' }).click();
    await expect(page.getByLabel('Programme hierarchy')).toBeVisible();

    const summary = page.getByLabel('Programme reporting summary');
    await expect(summary).toContainText('8');
    await expect(summary).toContainText('submitted');

    // Default selected team mmm-a is submitted: the four goal labels appear in detail.
    await expect(page.getByText('Business goal')).toBeVisible();
    await expect(page.getByText('Technical / testing goal')).toBeVisible();
    await expect(page.getByText('Sprint commitment')).toBeVisible();
    await expect(page.getByText('Next week commitment')).toBeVisible();
  });

  test('filtering to an empty result offers a reset', async ({ page }) => {
    await page.getByRole('tab', { name: 'Leadership View' }).click();
    await page.getByLabel('Stream').selectOption('Visa');
    await page.getByLabel('Update state').selectOption('MISSING');
    await expect(page.getByText('No teams match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page.getByLabel('Programme hierarchy')).toBeVisible();
  });

  test('a stale update is clearly labelled in Leadership View at Week 2', async ({ page }) => {
    await page.getByRole('tab', { name: 'Leadership View' }).click();
    await page.getByRole('button', { name: /VIS-PMNT/ }).click();
    await page.getByRole('button', { name: /Week 2/ }).click();
    await expect(page.getByText(/showing the latest submission from Week 1/i)).toBeVisible();
  });
});
