import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './support/auth';

// Visual regression (task 10.5). The PoC gate is 1440x1000 (desktop) and
// 390x844 (phone) per design §14; the intermediate 1024x768 and 768x1024
// breakpoints stay as design targets (§11) and are exercised here for extra
// coverage but are not the PoC gate. Baselines are chromium-only (Chrome is the
// supported browser; Safari is smoke-tested without a visual gate). Generate
// baselines with `--update-snapshots`; animations are disabled for stability.
const VIEWPORTS = [
  { name: '1440x1000', width: 1440, height: 1000 }, // PoC gate — desktop
  { name: '1024x768', width: 1024, height: 768 }, // design target (not gated)
  { name: '768x1024', width: 768, height: 1024 }, // design target (not gated)
  { name: '390x844', width: 390, height: 844 }, // PoC gate — phone
];

for (const vp of VIEWPORTS) {
  test.describe(`visual @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('Team Update', async ({ page }) => {
      // TEAM_LEAD exposes the Team Update view.
      await signIn(page, ACCOUNTS.lead);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('update');
      await expect(page).toHaveScreenshot(`team-update-${vp.name}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.02,
      });
    });

    test('Leadership View', async ({ page }) => {
      // ADMIN exposes the Leadership View tab (admin@ → Leadership View).
      await signIn(page, ACCOUNTS.admin);
      await page.getByRole('tab', { name: 'Leadership View' }).click();
      await expect(page.getByLabel('Programme hierarchy')).toBeVisible();
      await expect(page).toHaveScreenshot(`leadership-${vp.name}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.02,
      });
    });
  });
}
