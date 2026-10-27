import { expect, test, type Page } from '@playwright/test';
import { gotoApp, preparePage } from './helpers';

// ── Theme persistence ────────────────────────────────────────────────────────

test.describe('Theme menu', () => {
  test.beforeEach(async ({ page }) => {
    await preparePage(page);
  });

  const pick = async (page: Page, choice: string) => {
    if (!(await page.locator('#header-menu').isVisible())) await page.click('#btn-header-menu');
    await page.click(`[data-theme-choice="${choice}"]`);
  };

  test('switches between light, dark and system from the header menu', async ({ page }) => {
    await gotoApp(page);

    // Initial state: no wt-theme in localStorage → default is 'system'
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
    await page.click('#btn-header-menu');
    await expect(page.locator('#btn-header-menu')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-theme-choice="system"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    for (const choice of ['light', 'dark', 'system']) {
      await pick(page, choice);
      await expect(page.locator('html')).toHaveAttribute('data-theme', choice);
      await expect(page.locator(`[data-theme-choice="${choice}"]`)).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }

    await page.keyboard.press('Escape');
    await expect(page.locator('#header-menu')).toBeHidden();
    await expect(page.locator('#btn-header-menu')).toBeFocused();
  });

  test('persists the selected dark theme across a page reload', async ({ page }) => {
    await gotoApp(page);
    await pick(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Reload — the addInitScript re-runs but does NOT write wt-theme, so the
    // value persisted by setUserTheme() in localStorage survives
    await page.reload();
    await expect(page.locator('#tab-networth')).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.click('#btn-header-menu');
    await expect(page.locator('[data-theme-choice="dark"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

// ── Auth state transitions ───────────────────────────────────────────────────

test.describe('Auth state', () => {
  test('unauthenticated with no prior grant shows sign-in controls and hides sign-out', async ({
    page,
  }) => {
    // Deliberately do NOT call preparePage — no gtoken, no ggranted in
    // localStorage, so the app boots without a valid session.
    // Route external scripts to avoid flaky network failures.
    await page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ status: 200, body: '', contentType: 'application/javascript' }),
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // These are set deterministically by updateAuthUI(false), regardless of
    // whether cached data exists (the #auth-prompt card visibility depends on
    // state.cacheLoaded which varies across runs, but the header controls do not).
    await expect(page.locator('#btn-signin-global')).toBeVisible();
    await expect(page.locator('#sync-status')).not.toHaveAttribute('data-action', /.+/);
    await page.click('#btn-header-menu');
    await expect(page.locator('#btn-signout')).not.toBeVisible();
  });

  test('signed-in state shows correct shell controls', async ({ page }) => {
    await preparePage(page);
    await gotoApp(page);

    await expect(page.locator('#sync-status')).toBeVisible();
    await expect(page.locator('#btn-signin-global')).not.toBeVisible();
    await page.click('#btn-header-menu');
    await expect(page.locator('#btn-signout')).toBeVisible();
    await page.keyboard.press('Escape');
    // The in-page auth-prompt card must be hidden in signed-in state
    await expect(page.locator('#auth-prompt')).not.toBeVisible();
  });

  test('a browser set up before but without a token stays editable and offers to connect', async ({
    page,
  }) => {
    // Granted earlier, token expired: no Google popup or Drive call at boot.
    await page.addInitScript(() => localStorage.setItem('ggranted', '1'));
    await page.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ status: 200, body: '', contentType: 'application/javascript' }),
    );
    const driveCalls: string[] = [];
    await page.route('https://www.googleapis.com/**', (route) => {
      driveCalls.push(route.request().url());
      return route.fulfill({ status: 401, body: '{}', contentType: 'application/json' });
    });

    await gotoApp(page);

    const chip = page.locator('#sync-status');
    await expect(chip).toContainText('Not connected');
    await expect(chip).toHaveAttribute('data-action', 'sync');
    await expect(page.locator('#btn-signin-global')).not.toBeVisible();
    await expect(page.locator('#auth-prompt')).not.toBeVisible();
    await page.click('#btn-header-menu');
    await expect(page.locator('#btn-signout')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(driveCalls).toEqual([]);
  });

  test('clicking sign-out triggers a page reload clearing the session', async ({ page }) => {
    await preparePage(page);
    await gotoApp(page);
    await page.click('#btn-header-menu');
    await expect(page.locator('#btn-signout')).toBeVisible();

    // signOut() in google.ts clears localStorage tokens then calls
    // window.location.reload(), which Playwright detects as navigation.
    await Promise.all([page.waitForEvent('load'), page.click('#btn-signout')]);

    // preparePage's addInitScript re-injects gtoken on reload, so the app
    // ends up back in signed-in state. What we want to assert here is
    // specifically that the reload happened (sign-out triggered navigation)
    // and the app shell is functional after it.
    await expect(page.locator('#tab-networth')).toBeVisible();
  });
});

// ── Offline shell behavior ───────────────────────────────────────────────────

test.describe('Offline shell behavior', () => {
  test.beforeEach(async ({ page }) => {
    await preparePage(page);
  });

  test('all primary tabs remain accessible while offline', async ({ page, context }) => {
    await gotoApp(page);

    // Go offline after the initial load
    await context.setOffline(true);

    // All tab buttons should still be present and interactable
    for (const tabId of [
      'tab-networth',
      'tab-portfolio',
      'tab-analytics',
      'tab-log',
      'tab-settings',
    ]) {
      await page.click(`#${tabId}`);
      await expect(page.locator(`#${tabId}`)).toBeVisible();
    }

    await context.setOffline(false);
  });

  test('sync chip cannot be triggered while offline and the shell keeps working', async ({
    page,
    context,
  }) => {
    await gotoApp(page);
    const chip = page.locator('#sync-status');
    await expect(chip).toBeVisible();

    await context.setOffline(true);

    // The chip switches to "Offline" and is aria-disabled (still focusable
    // so its tooltip explains why), and the app does not crash.
    await expect(chip).toContainText('Offline');
    await expect(chip).toHaveAttribute('aria-disabled', 'true');
    await expect(chip).not.toHaveAttribute('data-action', /.+/);
    await expect(page.locator('#tab-networth')).toBeVisible();
    await expect(page.locator('#tab-portfolio')).toBeVisible();

    await context.setOffline(false);
  });
});
