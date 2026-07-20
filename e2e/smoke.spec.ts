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

  // Let the renderer settle, then assert no uncaught renderer errors occurred.
  await page.waitForTimeout(1500)
  expect(errors).toEqual([])
})
