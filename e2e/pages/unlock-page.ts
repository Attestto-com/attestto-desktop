import { expect, type Page } from '@playwright/test'

/**
 * The vault-unlock gate. On a fresh `--user-data-dir` the vault does not
 * exist, so the page is always in create mode. `createVaultAndEnter` clicks
 * the single create button and waits until the app lands on Settings (the
 * `/` redirect target). If a password field is added to the UX later, only
 * this method changes — specs stay untouched.
 */
export class UnlockPage {
  constructor(private readonly page: Page) {}

  async createVaultAndEnter(): Promise<void> {
    await this.page.getByTestId('vault-create-btn').click()
    await expect(this.page.getByTestId('view-settings-root')).toBeVisible()
  }
}
