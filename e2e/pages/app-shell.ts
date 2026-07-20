import type { Page } from '@playwright/test'

/**
 * Navigation wrapper. Drives vue-router (hash history) directly so tests are
 * decoupled from nav chrome — a reskin of the header/drawer cannot break them.
 * Setting the hash triggers the real router guard and view mount.
 */
export class AppShell {
  constructor(private readonly page: Page) {}

  async goto(hash: string): Promise<void> {
    await this.page.evaluate((h) => {
      window.location.hash = h
    }, hash)
  }
}
