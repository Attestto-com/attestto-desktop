import { test, expect } from './fixtures'
import { UnlockPage } from './pages/unlock-page'
import { AppShell } from './pages/app-shell'
import { CORE_VIEWS } from './pages/view-matrix'

test('create a vault, then every core view renders without error', async ({
  page,
  errors,
}) => {
  await new UnlockPage(page).createVaultAndEnter()

  const shell = new AppShell(page)
  for (const view of CORE_VIEWS) {
    await shell.goto(view.hash)
    await expect(page.getByTestId(view.testid)).toBeVisible()
  }

  expect(errors).toEqual([])
})
