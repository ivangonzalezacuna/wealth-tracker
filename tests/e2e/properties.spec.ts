import fs from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ensureCardExpanded, gotoApp, preparePage, waitForSyncIdle, expectToast } from './helpers';

test.beforeEach(async ({ page }) => {
  await preparePage(page);
  await gotoApp(page);
});

async function saveProperties(page: Page) {
  await page.click('#btn-save-properties');
  await expectToast(page, 'properties-msg', 'Properties saved');
  await expect(page.locator('#btn-save-properties')).toBeHidden();
  await expect(page.locator('#sync-status')).toHaveAccessibleName(/Synced with Google Drive/);
}

test('property register persists, backs up and restores without creating financial data', async ({
  page,
}, testInfo) => {
  await expect(page.locator('#nw-properties')).toBeHidden();
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.click('#btn-add-property');
  await expect(page.locator('#property-mortgage')).toHaveValue('unknown');
  await page.fill('#property-name', 'Shared home');
  await page.fill('#property-value', '420000');
  await page.fill('#property-share', '50');
  await page.selectOption('#property-mortgage', 'known');
  await page.fill('#property-debt', '140000');
  await page.fill('#property-debt-date', '2020-11-30');
  await expect(page.locator('#property-preview')).toContainText('70.000');
  const payoff = page.locator('#property-payoff');
  const payoffSummary = payoff.locator('summary');
  await expect(payoff).not.toHaveAttribute('open', '');
  await payoffSummary.click();
  await page.fill('#property-rate', '3.5');
  await payoffSummary.click();
  await page.click('.js-property-save');
  await expect(page.locator('#property-payment')).toBeFocused();
  await page.fill('#property-payment', '400');
  await expect(page.locator('#property-payoff-result')).toHaveText(
    'This payment does not reduce your balance.',
  );
  await page.fill('#property-payment', '900');
  await expect(page.locator('#property-payoff-result')).toHaveText('Estimated payoff: Mar 2038');
  await page.click('.js-property-save');
  await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
  await expect(page.locator('#settings-card-properties')).toContainText('Shared home');
  await expect(page.locator('#settings-card-properties .b-draft-new')).toBeVisible();
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toBeHidden();
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-properties');
  await expect(page.locator('#settings-card-properties .b-draft-new')).toBeVisible();
  await saveProperties(page);
  await waitForSyncIdle(page);
  await page.reload();
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toBeVisible();
  await expect(page.locator('#nw-content')).toBeHidden();
  await expect(page.locator('#nw-empty')).toBeVisible();
  await page.locator('#nw-properties summary').click();
  await expect(page.locator('#nw-properties')).toContainText('70.000');
  await expect(page.locator('#nw-properties')).toContainText('Estimated payoff: Mar 2038');
  await expect(page.locator('#nw-properties a')).toHaveCount(0);
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.getByRole('button', { name: 'Edit property Shared home', exact: true }).click();
  await payoffSummary.click();
  await expect(page.locator('#property-rate')).toHaveValue('3.5');
  await expect(page.locator('#property-payment')).toHaveValue('900');
  await page.fill('#property-debt', '130000');
  await page.fill('#property-debt-date', '2020-12-31');
  await expect(page.locator('#property-payoff-result')).toHaveText('Estimated payoff: Aug 2036');
  await page.click('.js-property-save');
  await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
  await expect(page.locator('#settings-card-properties')).toContainText('80.000');
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toContainText('70.000');
  await expect(page.locator('#nw-properties')).not.toContainText('80.000');
  await expect(page.locator('#nw-properties')).toContainText('Estimated payoff: Mar 2038');
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-properties');
  await saveProperties(page);

  await ensureCardExpanded(page, 'settings-card-backup');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#btn-export-backup');
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath('properties-backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  expect(backup.data.accounts).toEqual([]);
  expect(backup.data.snapshots).toEqual([]);
  expect(backup.data.transactions).toEqual([]);
  expect(JSON.parse(backup.data.settings.property_register).properties[0]).toMatchObject({
    debt: 130000,
    debtDate: '2020-12-31',
    mortgageTerms: { annualRate: 3.5, monthlyPayment: 900 },
  });
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.getByRole('button', { name: 'Delete property Shared home', exact: true }).click();
  await expect(page.locator('#settings-card-properties .b-draft-removed')).toBeVisible();
  await saveProperties(page);
  await expect(page.locator('#settings-card-properties')).toContainText('No properties yet');
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toBeHidden();
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-backup');
  await page.setInputFiles('#backup-file-input', backupPath);
  await page.click('.js-confirm-ok');
  await expectToast(page, 'backup-msg', 'Restore complete.');
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toBeVisible();
  await page.locator('#nw-properties summary').click();
  await expect(page.locator('#nw-properties')).toContainText('80.000');
  await expect(page.locator('#nw-properties')).toContainText('Estimated payoff: Aug 2036');
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.getByRole('button', { name: 'Edit property Shared home', exact: true }).click();
  await payoffSummary.click();
  await page.fill('#property-rate', '');
  await page.fill('#property-payment', '');
  await page.click('.js-property-save');
  await saveProperties(page);
  await page.click('#tab-networth');
  await expect(page.locator('#nw-properties')).toContainText('80.000');
  await expect(page.locator('#nw-properties')).not.toContainText('Estimated payoff');
});

test('property dialog and summary fit a phone and allow unknown debt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#tab-settings');
  await ensureCardExpanded(page, 'settings-card-properties');
  await page.click('#btn-add-property');
  await page.fill('#property-name', 'Inherited home');
  await page.fill('#property-value', '360000');
  await page.fill('#property-share', '33.333333333333336');
  await page.selectOption('#property-use', 'Inherited property');
  await expect(page.locator('#property-preview')).toContainText('Not calculated yet');
  expect(
    await page
      .locator('.property-dialog-overlay .dialog-card')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.click('.js-property-save');
  await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
  await saveProperties(page);
  await page.click('#tab-networth');
  await page.locator('#nw-properties summary').click();
  await expect(page.locator('#nw-properties')).toContainText('Mortgage details missing');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

async function expectCompactHeading(heading: Locator) {
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  const padding = await heading.evaluate((button) => {
    const outer = button.getBoundingClientRect();
    const inner = button.querySelector('.settings-card-label')!.getBoundingClientRect();
    return Math.min(inner.top - outer.top, outer.bottom - inner.bottom);
  });
  expect(padding).toBeGreaterThanOrEqual(7);
}

async function dialogMetrics(page: Page, overlay: string) {
  return page.locator(overlay).evaluate((root) => {
    const styles = (selector: string) => {
      const element = root.querySelector(selector)!;
      const css = getComputedStyle(element);
      return {
        fontSize: css.fontSize,
        fontWeight: css.fontWeight,
        padding: css.padding,
        borderRadius: css.borderRadius,
        height: Math.round(element.getBoundingClientRect().height * 100) / 100,
      };
    };
    return {
      width: root.querySelector('.dialog-card')!.getBoundingClientRect().width,
      input: styles('input'),
      label: styles('.dialog-label'),
      button: styles('.dialog-actions .btn:not(.dialog-remove)'),
      heading: styles('.dialog-title'),
    };
  });
}

async function expectDialogFits(page: Page) {
  const card = page.locator('.property-dialog-overlay .dialog-card');
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = (await card.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(viewport.height + 1);
  const bounds = (await card.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  for (const selector of ['.dialog-card', '.dialog-fields']) {
    expect(
      await page
        .locator(`.property-dialog-overlay ${selector}`)
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  }
  await expect(page.locator('.js-property-save')).toBeInViewport();
}

for (const profile of [
  { name: 'wide', width: 1440, height: 1000, touch: false, dark: false },
  { name: 'tablet', width: 768, height: 1024, touch: true, dark: false },
  { name: 'phone', width: 390, height: 844, touch: true, dark: false },
  { name: 'small-phone', width: 320, height: 568, touch: true, dark: false },
  { name: 'landscape', width: 844, height: 390, touch: true, dark: false },
  { name: 'dark-wide', width: 1440, height: 1000, touch: false, dark: true },
  { name: 'dark-phone', width: 390, height: 844, touch: true, dark: true },
]) {
  test.describe(`property appearance: ${profile.name}`, () => {
    test.use({
      viewport: { width: profile.width, height: profile.height },
      hasTouch: profile.touch,
      colorScheme: profile.dark ? 'dark' : 'light',
    });

    test('matches shared forms and supports the complete responsive management flow', async ({
      page,
    }, testInfo) => {
      await page.click('#tab-settings');
      await ensureCardExpanded(page, 'settings-card-accounts');
      await page.click('#btn-add-acct');
      await expect(page.locator('.acct-dialog-overlay .dialog-card')).toBeVisible();
      const reference = await dialogMetrics(page, '.acct-dialog-overlay');
      await page.keyboard.press('Escape');

      await ensureCardExpanded(page, 'settings-card-properties');
      const heading = page.locator('#settings-heading-properties');
      await heading.click();
      await expectCompactHeading(heading);
      await heading.click();
      await page.click('#btn-add-property');
      await expect(page.locator('.property-dialog-overlay .dialog-card')).toBeVisible();
      expect(await dialogMetrics(page, '.property-dialog-overlay')).toEqual(reference);
      await expectDialogFits(page);
      await page.click('.js-property-save');
      await expect(page.locator('#property-name')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#property-value')).toHaveAttribute('aria-invalid', 'true');
      await expectDialogFits(page);
      const name = 'Family apartment with a shared mortgage and a long name';
      const fillSharedHome = async () => {
        await page.fill('#property-name', name);
        await page.fill('#property-value', '420000');
        await page.fill('#property-share', '50');
        await page.selectOption('#property-mortgage', 'known');
        await page.fill('#property-debt', '240000');
      };
      await fillSharedHome();
      await expect(page.locator('#property-preview')).toContainText('-30.000');
      const negativeColor = await page
        .locator('#property-preview .neg')
        .evaluate((element) => getComputedStyle(element).color);
      await expectDialogFits(page);
      await page.locator('#property-payoff summary').click();
      await page.fill('#property-rate', '3.5');
      await page.fill('#property-payment', '1450');
      await expect(page.locator('#property-payoff-result')).toContainText('Estimated payoff:');
      await page.locator('#property-payoff-result').scrollIntoViewIfNeeded();
      await expectDialogFits(page);
      await capture(page, testInfo, 'property-payoff');
      await page.click('.js-property-save');
      await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
      const row = page.locator('#settings-card-properties .settings-item');
      await expect(row).toContainText('-30.000');
      await expect(row.locator('.neg')).toHaveCSS('color', negativeColor);
      await expect(row.locator('.b-draft-new')).toBeVisible();
      await heading.click();
      await expectCompactHeading(heading);
      await expect(page.locator('#settings-card-properties')).toHaveClass(/settings-dirty/);
      await capture(page, testInfo, 'properties-draft-collapsed');
      await heading.click();
      await page.click('#btn-discard-properties');
      await expect(row).toHaveCount(0);
      await page.click('#btn-add-property');
      await fillSharedHome();
      await page.click('.js-property-save');
      await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
      await saveProperties(page);
      const edit = row.locator('.js-edit-property');
      const openEdit = async () => {
        await ((await edit.isVisible()) ? edit : row).click();
      };
      await openEdit();
      await expect(page.locator('#property-name')).toHaveValue(name);
      await page.selectOption('#property-mortgage', 'none');
      await expect(page.locator('#property-preview')).toContainText('210.000');
      await expect(page.locator('#property-preview .neg')).toHaveCount(0);
      await page.selectOption('#property-mortgage', 'unknown');
      await expect(page.locator('#property-debt')).toBeDisabled();
      await page.click('.js-property-save');
      await expect(page.locator('.property-dialog-overlay')).toHaveCount(0);
      await expect(row.locator('.b-draft-edited')).toBeVisible();
      await saveProperties(page);
      await page.click('#tab-networth');
      await page.locator('#nw-properties summary').click();
      await expect(page.locator('#nw-properties')).toContainText('Mortgage details missing');
      await expect(page.locator('#nw-properties')).toContainText('Not calculated yet');
      await page.locator('#nw-properties').scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await capture(page, testInfo, 'property-overview');
      await expect(page.locator('#nw-properties a')).toHaveCount(0);
      await page.click('#tab-settings');
      await ensureCardExpanded(page, 'settings-card-properties');
      await openEdit();
      await page.click('.property-dialog-overlay .dialog-remove');
      await expect(row.locator('.b-draft-removed')).toBeVisible();
      await row.getByRole('button', { name: `Undo remove property ${name}`, exact: true }).click();
      await expect(row).toContainText(name);
      await openEdit();
      await page.click('.property-dialog-overlay .dialog-remove');
      await saveProperties(page);
      await expect(page.locator('#settings-card-properties')).toContainText('No properties yet');
    });
  });
}
