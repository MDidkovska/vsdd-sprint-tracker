import { expect, type Page } from '@playwright/test';

/**
 * Shared sign-in helper for the e2e suite.
 *
 * The mock auth client (src/auth/mockAuthClient.ts) is IN-MEMORY with no
 * session persistence: every page load resets to anonymous and shows the
 * Phase 8 login screen. So every test must authenticate AFTER navigating to
 * the app root — this helper does the navigation and the login together.
 *
 * Seeded mock accounts (all share the password below):
 *   - admin@vsdd.test    ADMIN                (Leadership View, Admin, Audit)
 *   - lead@vsdd.test     TEAM_LEAD (mmm-a)    (Team Update)
 *   - auditor@vsdd.test  AUDITOR              (Leadership View, Audit — read-only)
 *   - pending@vsdd.test  PENDING              (do NOT use — no programme access)
 *
 * No single account exposes BOTH Team Update and Leadership View, so callers
 * pick the account that matches the tab under test.
 */
export const MOCK_PASSWORD = 'password123';

export const ACCOUNTS = {
  admin: 'admin@vsdd.test',
  lead: 'lead@vsdd.test',
  auditor: 'auditor@vsdd.test',
} as const;

/**
 * Navigate to the app root and sign in with a seeded mock account, waiting
 * until the authenticated shell (the "Application views" tablist) is visible
 * so tests don't race the auth transition.
 */
export async function signIn(
  page: Page,
  email: string = ACCOUNTS.lead,
  password: string = MOCK_PASSWORD,
): Promise<void> {
  await page.goto('/');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Authenticated app shell is up once the role-aware tablist renders.
  await expect(page.getByRole('tablist', { name: 'Application views' })).toBeVisible();
}
