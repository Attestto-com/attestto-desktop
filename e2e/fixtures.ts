import {
  test as base,
  _electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Console/pageerror messages matching any of these are ignored. Starts empty;
 * add a pattern here (never in a spec) if a known-benign third-party warning
 * ever surfaces, so specs stay strict-by-default.
 */
const IGNORED_ERROR_PATTERNS: RegExp[] = []

type Fixtures = {
  app: ElectronApplication
  errors: string[]
  page: Page
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'attestto-e2e-'))
    const app = await _electron.launch({
      args: [
        '.',
        `--user-data-dir=${userDataDir}`,
        '--use-fake-device-for-media-stream',
      ],
      env: {
        ...process.env,
        ATTESTTO_E2E: '1',
        MESH_BOOTSTRAP_PEERS: '',
        NODE_ENV: 'test',
      },
    })
    await use(app)
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  },

  // Depends on `app`; resolves `firstWindow` and attaches listeners BEFORE the
  // `page` fixture hands the same window to the test, so early errors are caught.
  errors: async ({ app }, use) => {
    const errors: string[] = []
    const record = (msg: string) => {
      if (!IGNORED_ERROR_PATTERNS.some((re) => re.test(msg))) errors.push(msg)
    }
    const page = await app.firstWindow()
    page.on('pageerror', (e) => record(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') record(`console.error: ${m.text()}`)
    })
    await use(errors)
  },

  page: async ({ app, errors }, use) => {
    // `errors` listed as a dep so its listeners attach first. `firstWindow`
    // returns the same cached Page instance.
    void errors
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },
})

export { expect } from '@playwright/test'
