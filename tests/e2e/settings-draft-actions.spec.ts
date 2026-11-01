import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  ensureCardExpanded,
  gotoApp,
  openTab,
  preparePage,
  saveSettings,
  waitForSyncIdle,
} from './helpers';

async function capture(page: Page, info: TestInfo, card: string, name: string) {
  for (const dismiss of await page.getByRole('button', { name: 'Dismiss notification' }).all())
    await dismiss.click();
  const target = page.locator(`#settings-card-${card}`);
  await expect(target).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  for (const button of await target
    .locator('[data-discard-for]:visible, button[data-dirty]:visible')
    .all()) {
    await expect(button).toHaveCSS('font-size', '11px');
    expect((await button.boundingBox())!.height).toBeLessThan(35);
  }
  for (const group of await target.locator('.settings-draft-actions:visible').all()) {
    const buttons = await group.locator('button:visible').all();
    if (buttons.length !== 2) continue;
    const [save, discard] = await Promise.all(buttons.map((button) => button.boundingBox()));
    expect(Math.abs(save!.y + save!.height / 2 - discard!.y - discard!.height / 2)).toBeLessThan(1);
  }
  await target.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
}

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1280]) {
    test(`shared settings draft actions: ${theme} ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await preparePage(page);
      await gotoApp(page);
      await waitForSyncIdle(page);
      await page.locator('#btn-header-menu').click();
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.keyboard.press('Escape');
      await openTab(page, 'tab-settings');
      await ensureCardExpanded(page, 'settings-card-accounts');
      await expect(page.locator('#btn-save-accts')).toBeHidden();
      await expect(page.locator('#btn-discard-accts')).toBeHidden();
      await capture(page, info, 'accounts', 'accounts-clean');
      const count = await page.locator('.settings-acct-row').count();
      await page.click('#btn-add-acct');
      await page.fill('#acctd-label', 'Unsaved account');
      await page.click('.js-acctd-submit');
      await expect(page.locator('.settings-acct-row')).toHaveCount(count + 1);
      await expect(page.locator('#btn-save-accts')).toHaveText('Save');
      await expect(page.locator('#btn-discard-accts')).toHaveText('Discard');
      await capture(page, info, 'accounts', 'accounts-draft');
      await page.click('#btn-discard-accts');
      await expect(page.locator('.settings-acct-row')).toHaveCount(count);
      await expect(page.locator('#btn-save-accts')).toBeHidden();
      await expect(page.locator('#btn-discard-accts')).toBeHidden();

      await ensureCardExpanded(page, 'settings-card-holdings');
      await page.click('#btn-add-hold');
      await page.fill('#holdd-isin', 'IE00B4L5Y983');
      await page.fill('#holdd-short-name', 'Draft ETF');
      await page.fill('#holdd-name', 'Unsaved holding');
      await page.click('.js-holdd-submit');
      await expect(page.locator('#settings-holdings-tbl')).toContainText('Draft ETF');
      await capture(page, info, 'holdings', 'holdings-draft');
      await page.click('#btn-discard-holds');
      await expect(page.locator('.settings-hold-row')).toHaveCount(0);
      await expect(page.locator('#btn-save-holds')).toBeHidden();

      await ensureCardExpanded(page, 'settings-card-contributions');
      const amount = await page.locator('#set-contrib-budget').inputValue();
      await page.fill('#set-contrib-budget', '765');
      await expect(page.locator('#btn-discard-contributions')).toBeVisible();
      await capture(page, info, 'contributions', 'contributions-draft');
      await page.click('#btn-discard-contributions');
      await expect(page.locator('#set-contrib-budget')).toHaveValue(amount);
      await expect(page.locator('#btn-save-contributions')).toBeHidden();

      await ensureCardExpanded(page, 'settings-card-calc-assumptions');
      const method = await page.locator('#set-cost-basis-method').inputValue();
      await page.selectOption('#set-cost-basis-method', method === 'fifo' ? 'avgco' : 'fifo');
      await page.fill('#analytics-risk-free-rate', '3.25');
      await capture(page, info, 'calc-assumptions', 'independent-drafts');
      await page.click('#btn-discard-cost-basis');
      await expect(page.locator('#set-cost-basis-method')).toHaveValue(method);
      await expect(page.locator('#analytics-risk-free-rate')).toHaveValue('3.25');
      await expect(page.locator('#btn-save-cost-basis')).toBeHidden();
      await expect(page.locator('#btn-save-analytics')).toBeVisible();
      await saveSettings(page, 'analytics', 'Analytics saved');
      await expect(page.locator('#btn-save-analytics')).toBeHidden();
      await expect(page.locator('#btn-discard-analytics')).toBeHidden();
      await waitForSyncIdle(page);
      await page.fill('#analytics-risk-free-rate', '4.5');
      await page.click('#btn-discard-analytics');
      await expect(page.locator('#analytics-risk-free-rate')).toHaveValue('3.25');
      await capture(page, info, 'calc-assumptions', 'assumptions-clean');

      await ensureCardExpanded(page, 'settings-card-portfolio-behavior');
      const rules = await page.locator('.settings-rule-row').count();
      await page.fill('#alert-drift-threshold', '8');
      await page.click('#btn-add-rule');
      await capture(page, info, 'portfolio-behavior', 'rules-and-alert-drafts');
      await page.click('#btn-discard-rules');
      await expect(page.locator('.settings-rule-row')).toHaveCount(rules);
      await expect(page.locator('#alert-drift-threshold')).toHaveValue('8');
      await expect(page.locator('#btn-save-rules')).toBeHidden();
      await page.click('#btn-discard-alerts');
      await expect(page.locator('#btn-save-alerts')).toBeHidden();

      await ensureCardExpanded(page, 'settings-card-goal');
      await page.click('#btn-add-goal');
      await page.fill('#goald-label', 'Unsaved goal');
      await page.fill('#goald-target', '10000');
      await page.click('.js-goald-submit');
      await expect(page.locator('#settings-goals-tbl')).toContainText('Unsaved goal');
      await capture(page, info, 'goal', 'goals-draft');
      await page.click('#btn-discard-goal');
      await expect(page.locator('.settings-goal-row')).toHaveCount(0);
      await expect(page.locator('#btn-save-goal')).toBeHidden();

      await ensureCardExpanded(page, 'settings-card-integrations');
      const mode = await page.locator('#settings-statement-mode').inputValue();
      const enabled = await page.locator('#fx-integration-enabled').isChecked();
      await page.selectOption('#settings-statement-mode', 'positions');
      await page.locator('#fx-integration-enabled').setChecked(!enabled);
      await capture(page, info, 'integrations', 'mapping-and-fx-drafts');
      await page.click('#btn-discard-statement-mapping');
      await expect(page.locator('#settings-statement-mode')).toHaveValue(mode);
      await expect(page.locator('#btn-discard-fx-integration')).toBeVisible();
      await page.click('#btn-discard-fx-integration');
      await expect(page.locator('#fx-integration-enabled')).toBeChecked({ checked: enabled });
      await expect(page.locator('#btn-save-fx-integration')).toBeHidden();
      await page.reload();
      await gotoApp(page);
      await openTab(page, 'tab-settings');
      await ensureCardExpanded(page, 'settings-card-accounts');
      await expect(page.locator('.settings-acct-row')).toHaveCount(count);
      await ensureCardExpanded(page, 'settings-card-calc-assumptions');
      await expect(page.locator('#analytics-risk-free-rate')).toHaveValue('3.25');
      await expect(page.locator('#set-cost-basis-method')).toHaveValue(method);
      await expect(page.locator('#btn-save-analytics')).toBeHidden();
    });
  }
}
