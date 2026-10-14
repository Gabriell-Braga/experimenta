import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { createExperiment, EDITOR, openEditor } from '../editor';

async function editTitleAndName(page: Page, site: FrameLocator, name: string) {
  await site.locator('#hero-title').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await page.getByTestId('side-settings').click();
  const field = page.getByTestId('settings').getByRole('textbox').first();
  await field.fill(name);
  await field.blur();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('save')).toHaveText('Salvo');
}

test('dois experimentos no mesmo elemento: o editor aponta o conflito', async ({ page }) => {
  const uniq = Math.random().toString(36).slice(2, 7);
  let site = await openEditor(page);
  await editTitleAndName(page, site, `Título A ${uniq}`);

  await page.goto(EDITOR);
  await createExperiment(page);
  await expect(page.getByTestId('status')).toHaveAttribute('data-connected', 'true');
  site = page.frameLocator('[data-testid=site-frame]');
  await editTitleAndName(page, site, `Título B ${uniq}`);

  await page.getByTestId('side-changes').click();
  await expect(page.getByTestId('conflicts')).toContainText(`Título A ${uniq}`);
  await expect(page.getByTestId('change-conflict').first()).toContainText(`Título A ${uniq}`);
});
