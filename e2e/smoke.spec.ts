import { test, expect } from './fixtures'

test('app boots: window mounts and the presenciaAPI bridge is live', async ({
  page,
  errors,
}) => {
  // The Vue app mounts into #app.
  await expect(page.locator('#app')).toBeVisible()

  // The preload bridge is exposed and reports Electron.
  const isElectron = await page.evaluate(
    () => (window as unknown as { presenciaAPI?: { isElectron?: boolean } }).presenciaAPI?.isElectron,
  )
  expect(isElectron).toBe(true)

  // Deterministic settle: on a fresh user-data dir the router guard lands on
  // the vault-unlock gate in create mode, so its create button is the first
  // interactive element the renderer paints. Waiting on it (not an arbitrary
  // sleep) proves boot + guard + first-view render completed before we assert
  // no uncaught renderer errors occurred.
  await expect(page.getByTestId('vault-create-btn')).toBeVisible()
  expect(errors).toEqual([])
})
