import { expect, test } from '@playwright/test';

test('login page renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Nephix')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
});
