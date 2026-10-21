import { expect, test } from '@playwright/test';
import {
  addAccount,
  addGoal,
  ensureCardExpanded,
  gotoApp,
  preparePage,
  saveSettings,
  waitForSyncIdle,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
  await page.locator('#tab-settings').click();
});

test('Settings tabs and accordions support keyboard navigation and hide inactive fields', async ({
  page,
}) => {
  await expect(page.locator('#settings-content .js-card-toggle')).toHaveCount(11);
  for (const view of ['portfolio', 'planning', 'advanced']) {
    const tab = page.locator(`[data-settings-view="${view}"]`);
    await tab.focus();
    await tab.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(view === 'portfolio' ? '#settings(?:/portfolio)?$' : `#settings/${view}$`),
    );
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#settings-content [role="tabpanel"]:visible')).toHaveCount(1);
    for (const button of await page.locator('#settings-content .js-card-toggle:visible').all()) {
      const expanded = (await button.getAttribute('aria-expanded')) === 'true';
      const body = page.locator(`#${await button.getAttribute('aria-controls')}`);
      await expect(button).toHaveJSProperty('tagName', 'BUTTON');
      await button.focus();
      await button.press('Enter');
      await expect(body).toBeVisible({ visible: !expanded });
      await button.press('Space');
      await expect(button).toHaveAttribute('aria-expanded', String(expanded));
    }
  }
  await page.locator('[data-settings-view="portfolio"]').click();
  const accounts = page.locator('#settings-heading-accounts');
  if ((await accounts.getAttribute('aria-expanded')) === 'true') await accounts.press('Enter');
  await accounts.focus();
  await accounts.press('Tab');
  await expect(page.locator('#settings-heading-holdings')).toBeFocused();
  await ensureCardExpanded(page, 'settings-card-reports');
  await expect(page.locator('#report-msg')).toContainText('No data found');
  await expect(page.locator('#btn-download-report')).toBeDisabled();
});

test('goal and milestone month inputs persist in the browser', async ({ page }) => {
  await addGoal(page, {
    label: 'Accessible goal',
    targetNetWorth: '100000',
    targetDate: '2035-06',
  });
  await page.locator('.js-edit-goal').click();
  const goalDate = page.locator('#goald-date');
  await expect(goalDate).toBeVisible();
  await expect(goalDate).toHaveValue('2035-06');
  await page.locator('.js-ms-add').click();
  await page.locator('.ms-amount').fill('25000');
  const deadline = page.locator('input[id^="goald-ms-date-"]');
  await deadline.fill('2034-06');
  await deadline.press('Tab');
  await page.locator('.js-goald-submit').click();
  await expect(page.locator('#settings-card-goal .settings-draft-status')).toHaveText(
    'Unsaved changes',
  );
  await saveSettings(page, 'goal', 'Goals saved');
  await expect(page.locator('#settings-card-goal .settings-draft-status')).toBeEmpty();
  await waitForSyncIdle(page);
  await page.reload();
  await page.locator('#tab-settings').click();
  await ensureCardExpanded(page, 'settings-card-goal');
  await page.locator('.js-edit-goal').click();
  await expect(goalDate).toHaveValue('2035-06');
  await expect(deadline).toHaveValue('2034-06');
  await page.locator('.js-goald-cancel').click();
});

test('compact Settings rows and dialogs fit mobile, tablet, desktop and short landscape', async ({
  page,
}) => {
  await addAccount(page, {
    label: 'Long descriptive international brokerage account for retirement',
    institution: 'Synthetic international institution with a long name',
    primary: true,
  });
  await addGoal(page, {
    label: 'Long descriptive financial independence target for the whole household',
    targetNetWorth: '100000',
  });
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1280, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    for (const view of ['portfolio', 'planning', 'advanced']) {
      await page.locator(`[data-settings-view="${view}"]`).click();
      for (const toggle of await page.locator('#settings-content .js-card-toggle:visible').all())
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      const layout = await page.locator('#settings-content').evaluate((root) => {
        const visible = (selector: string) =>
          [...root.querySelectorAll<HTMLElement>(selector)].filter(
            (el) => el.getClientRects().length,
          );
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          buttons: visible('.btn:not(.js-card-toggle)').every(
            (el) => el.getBoundingClientRect().height <= 28,
          ),
          inputs: visible('.form-input, .planning-input').every(
            (el) => el.getBoundingClientRect().height <= 38,
          ),
          identities: visible('.settings-item-title').every(
            (el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
          ),
          actions: visible('.settings-row-actions').every((actions) => {
            const [edit, remove] = [...actions.querySelectorAll('.btn-icon')].map((el) =>
              el.getBoundingClientRect(),
            );
            const row = actions.closest('.settings-item')!.getBoundingClientRect();
            const box = actions.getBoundingClientRect();
            return (
              edit &&
              remove &&
              remove.left - edit.right >= 4 &&
              box.top >= row.top - 1 &&
              box.bottom <= row.bottom + 1 &&
              [edit, remove].every((r) => r.width >= 24 && r.height >= 24)
            );
          }),
          navPosition: getComputedStyle(root.querySelector('.settings-tabs')!).position,
        };
      });
      expect(layout, `${width}x${height} ${view}`).toEqual({
        overflow: 0,
        buttons: true,
        inputs: true,
        identities: true,
        actions: true,
        navPosition: 'static',
      });
    }
    for (const [section, opener, overlay, cancel] of [
      ['accounts', '#btn-add-acct', '.acct-dialog-overlay', '.js-acctd-cancel'],
      ['holdings', '#btn-add-hold', '.hold-dialog-overlay', '.js-holdd-cancel'],
      ['goal', '#btn-add-goal', '.goal-dialog-overlay', '.js-goald-cancel'],
    ]) {
      await ensureCardExpanded(page, `settings-card-${section}`);
      await page.locator(opener).click();
      const optional = page.locator(`${overlay} .dialog-optional`);
      if (await optional.count()) {
        await expect(optional).not.toHaveAttribute('open');
        await optional.locator('summary').press('Enter');
        await expect(optional).toHaveAttribute('open');
      }
      const bounds = await page.locator(`${overlay} .dialog-card`).evaluate((card) => {
        const box = card.getBoundingClientRect();
        const actions = card.querySelector('.dialog-actions')!.getBoundingClientRect();
        return (
          box.left >= 0 &&
          box.right <= innerWidth &&
          box.top >= 0 &&
          box.bottom <= innerHeight &&
          actions.left >= box.left &&
          actions.right <= box.right &&
          actions.top >= box.top &&
          actions.bottom <= box.bottom
        );
      });
      expect(bounds, `${width}x${height} ${overlay} card and actions inside viewport`).toBe(true);
      await expect(page.locator(cancel)).toBeInViewport();
      await page.locator(cancel).click();
    }
  }
});
