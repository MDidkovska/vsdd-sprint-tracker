import { expect, test } from '@playwright/test';

// Visual regression at the four required viewports. Baselines are generated on
// first run with `--update-snapshots`. Animations are disabled for stability.
const VIEWPORTS = [
  { name: '1440x1000', width: 1440, height: 1000 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test.describe(`visual @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('Team Update', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('update');
      await expect(page).toHaveScreenshot(`team-update-${vp.name}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.02,
      });
    });

    test('Leadership View', async ({ page }) => {
      await page.goto('/');
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
