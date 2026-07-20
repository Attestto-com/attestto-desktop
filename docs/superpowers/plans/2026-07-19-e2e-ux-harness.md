# Electron E2E UX Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright-Electron E2E harness that launches the real attestto-desktop app, crosses the vault-unlock gate, clicks through the core views, and fails on any renderer crash — decoupled from the UX via a Page Object Model + `data-testid` anchors.

**Architecture:** `@playwright/test` drives the built Electron app (`_electron.launch`) against an ephemeral `--user-data-dir` (fresh vault per run). A new `ATTESTTO_E2E` env guard skips mesh startup for offline determinism. Specs never touch selectors directly — they call page objects that resolve `data-testid` anchors, so a reskin or new sign-in screen cannot break them.

**Tech Stack:** Electron 39, Vue 3 + Quasar, vue-router (hash history), electron-vite, Playwright Test, vitest (existing unit suite, untouched).

## Global Constraints

- Public repo (Apache-2.0): no PII, no private keys, no internal references in code or fixtures.
- `CHANGELOG.md` gets a Keep-a-Changelog entry under `## [Unreleased]` for every `src/` change (CI-enforced by `build.yml`). E2E-only files under `e2e/` are not `src/` but the two `src/` edits (mesh guard, view testids) each need an entry.
- The `ATTESTTO_E2E` guard is additive and gated strictly on `process.env.ATTESTTO_E2E === '1'`; unset launches must behave exactly as today (mesh still starts).
- Vault cipher / crypto behavior is untouched.
- Selectors in specs and page objects use `getByTestId` **only** — never CSS class, never visible-text, never DOM structure.
- Electron runs sequentially: `fullyParallel: false`, `workers: 1`.
- Existing `pnpm test` (vitest, 78 tests) must stay green; E2E is a separate `pnpm test:e2e` command.
- did:sns format rules and all other repo CLAUDE.md rules still apply.

---

### Task 1: `ATTESTTO_E2E` mesh-skip guard

**Files:**
- Modify: `src/main/index.ts:180-197` (the "Start mesh node" block)
- Modify: `CHANGELOG.md` (add `## [Unreleased]` entry)

**Interfaces:**
- Produces: environment contract — when `process.env.ATTESTTO_E2E === '1'`, the app boots without starting the libp2p mesh node and logs `[mesh] Skipped (ATTESTTO_E2E=1)`. Consumed by the harness fixture in Task 2.

- [ ] **Step 1: Replace the mesh-start block with an env-gated version**

In `src/main/index.ts`, the current block is:

```ts
    // Start mesh node
    try {
      const bootstrapPeers = (process.env.MESH_BOOTSTRAP_PEERS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      await meshService.start(bootstrapPeers.length > 0 ? { bootstrapPeers } : undefined)
      const node = meshService.getNode()
      console.log('[mesh] Node started —', node.peerId)
      console.log('[mesh] Effective bootstrap peers:', (node as any).config?.bootstrapPeers ?? '(unknown)')
      node.on('mesh:event', (evt: any) => {
        if (evt.type?.startsWith('peer:') || evt.type === 'dht:ready') {
          console.log('[mesh:event]', JSON.stringify(evt))
        }
      })
    } catch (err) {
      console.error('[mesh] Failed to start:', err)
    }
```

Replace it with:

```ts
    // Start mesh node (skipped under E2E for deterministic offline runs)
    if (process.env.ATTESTTO_E2E === '1') {
      console.log('[mesh] Skipped (ATTESTTO_E2E=1)')
    } else {
      try {
        const bootstrapPeers = (process.env.MESH_BOOTSTRAP_PEERS ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        await meshService.start(bootstrapPeers.length > 0 ? { bootstrapPeers } : undefined)
        const node = meshService.getNode()
        console.log('[mesh] Node started —', node.peerId)
        console.log('[mesh] Effective bootstrap peers:', (node as any).config?.bootstrapPeers ?? '(unknown)')
        node.on('mesh:event', (evt: any) => {
          if (evt.type?.startsWith('peer:') || evt.type === 'dht:ready') {
            console.log('[mesh:event]', JSON.stringify(evt))
          }
        })
      } catch (err) {
        console.error('[mesh] Failed to start:', err)
      }
    }
```

- [ ] **Step 2: Verify type-check passes**

Run: `pnpm type-check`
Expected: exits 0, no errors.

- [ ] **Step 3: Verify the existing unit suite is unaffected**

Run: `pnpm test`
Expected: `Test Files 7 passed (7)`, `Tests 78 passed (78)`.

- [ ] **Step 4: Add the CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add (create the `### Added` subsection if absent):

```markdown
### Added
- E2E test hook: `ATTESTTO_E2E=1` env flag skips mesh startup for deterministic offline test runs.
```

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts CHANGELOG.md
git commit -m "feat(main): ATTESTTO_E2E flag to skip mesh startup for E2E"
```

---

### Task 2: Playwright harness scaffolding + smoke spec

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/global-setup.ts`
- Create: `e2e/fixtures.ts`
- Create: `e2e/smoke.spec.ts`
- Modify: `package.json` (add devDep `@playwright/test`, add `test:e2e` script)
- Modify: `.gitignore` (ignore Playwright output dirs)

**Interfaces:**
- Consumes: the `ATTESTTO_E2E` contract from Task 1.
- Produces:
  - `test` and `expect` re-exported from `e2e/fixtures.ts`, where `test` provides fixtures `app: ElectronApplication`, `page: Page`, and `errors: string[]` (accumulated `pageerror` + `console.error` messages, minus `IGNORED_ERROR_PATTERNS`).
  - `pnpm test:e2e` runs the suite.

- [ ] **Step 1: Install Playwright Test as a dev dependency**

Run: `pnpm add -D @playwright/test`
Expected: `@playwright/test` appears in `devDependencies`. (No `playwright install` browser download is needed — the `_electron` path uses the app's own Chromium.)

- [ ] **Step 2: Add the `test:e2e` script**

In `package.json` `scripts`, add:

```json
    "test:e2e": "playwright test",
```

- [ ] **Step 3: Ignore Playwright output**

Append to `.gitignore`:

```
# Playwright E2E
/test-results/
/playwright-report/
/e2e/.artifacts/
```

- [ ] **Step 4: Write the global setup (build once before the suite)**

Create `e2e/global-setup.ts`:

```ts
import { execSync } from 'node:child_process'

/**
 * Build the app once before the E2E suite so specs launch against a fresh
 * `out/` (main + preload + renderer). `pnpm build` runs `prebuild` →
 * `build:deps` (verify + mesh) then `electron-vite build`.
 */
export default function globalSetup(): void {
  execSync('pnpm build', { stdio: 'inherit' })
}
```

- [ ] **Step 5: Write the Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  outputDir: './e2e/.artifacts',
  use: {
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
})
```

- [ ] **Step 6: Write the launch fixture**

Create `e2e/fixtures.ts`:

```ts
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
```

- [ ] **Step 7: Write the smoke spec**

Create `e2e/smoke.spec.ts`:

```ts
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
```

- [ ] **Step 8: Run the smoke spec**

Run: `pnpm test:e2e e2e/smoke.spec.ts`
Expected: `1 passed`. (First run builds via globalSetup — allow up to a minute.)

- [ ] **Step 9: Commit**

```bash
git add playwright.config.ts e2e/global-setup.ts e2e/fixtures.ts e2e/smoke.spec.ts package.json pnpm-lock.yaml .gitignore
git commit -m "test(e2e): Playwright-Electron harness + smoke spec"
```

---

### Task 3: `data-testid` anchors on the unlock button and core view roots

**Files:**
- Modify: `src/renderer/views/VaultUnlockPage.vue:54` (the create button)
- Modify: `src/renderer/views/IdentityPage.vue:629`
- Modify: `src/renderer/views/CredentialsPage.vue:318`
- Modify: `src/renderer/views/SettingsPage.vue:159`
- Modify: `src/renderer/views/PdfPage.vue:456`
- Modify: `src/renderer/views/CedulaVerificationPage.vue:1281`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces stable test anchors consumed by Task 4's page objects:
  - `vault-create-btn` — the "Crear boveda segura" button on `/unlock` (create mode).
  - `view-settings-root`, `view-identity-root`, `view-credentials-root`, `view-pdf-root`, `view-cedula-root` — the `<q-page>` root of each core view.

- [ ] **Step 1: Anchor the create-vault button**

In `src/renderer/views/VaultUnlockPage.vue`, the `q-btn` at line 54 currently is:

```html
        <q-btn
          color="primary"
          label="Crear boveda segura"
          icon="lock"
          class="full-width q-mb-md"
          size="lg"
          :loading="vault.loading"
          @click="createVault"
        />
```

Add the `data-testid`:

```html
        <q-btn
          color="primary"
          label="Crear boveda segura"
          icon="lock"
          class="full-width q-mb-md"
          size="lg"
          :loading="vault.loading"
          data-testid="vault-create-btn"
          @click="createVault"
        />
```

- [ ] **Step 2: Anchor the five view roots**

Add a `data-testid` attribute to the root `<q-page>` of each view. Each is otherwise `<q-page class="...">`; add the attribute inline.

`src/renderer/views/SettingsPage.vue:159` — `<q-page class="settings-page">` becomes:
```html
  <q-page class="settings-page" data-testid="view-settings-root">
```

`src/renderer/views/IdentityPage.vue:629` — `<q-page class="page-centered">` becomes:
```html
  <q-page class="page-centered" data-testid="view-identity-root">
```

`src/renderer/views/CredentialsPage.vue:318` — `<q-page class="page-centered">` becomes:
```html
  <q-page class="page-centered" data-testid="view-credentials-root">
```

`src/renderer/views/CedulaVerificationPage.vue:1281` — `<q-page class="page-centered">` becomes:
```html
  <q-page class="page-centered" data-testid="view-cedula-root">
```

`src/renderer/views/PdfPage.vue:456` — the tag opens multiline (`<q-page` then attributes on following lines). Add `data-testid="view-pdf-root"` as the first attribute line directly under `<q-page`:
```html
  <q-page
    data-testid="view-pdf-root"
```
(Leave the existing attributes that follow unchanged.)

- [ ] **Step 3: Verify type-check and the build both pass**

Run: `pnpm type-check`
Expected: exits 0.

Run: `pnpm build`
Expected: build completes; `out/renderer` regenerated with no errors.

- [ ] **Step 4: Confirm the anchors are present in source**

Run: `grep -rn "data-testid=\"view-\|data-testid=\"vault-create-btn\"" src/renderer/views | wc -l`
Expected: `6`.

- [ ] **Step 5: Add the CHANGELOG entry**

Under `## [Unreleased]` `### Added` in `CHANGELOG.md`:

```markdown
- `data-testid` anchors on the vault-create button and the Identity, Credentials, Settings, Pdf, and cédula-verification view roots for E2E targeting.
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/views/VaultUnlockPage.vue src/renderer/views/IdentityPage.vue src/renderer/views/CredentialsPage.vue src/renderer/views/SettingsPage.vue src/renderer/views/PdfPage.vue src/renderer/views/CedulaVerificationPage.vue CHANGELOG.md
git commit -m "test(e2e): add data-testid anchors to unlock button and core view roots"
```

---

### Task 4: Page Object Model + core-flow spec

**Files:**
- Create: `e2e/pages/view-matrix.ts`
- Create: `e2e/pages/app-shell.ts`
- Create: `e2e/pages/unlock-page.ts`
- Create: `e2e/core-flow.spec.ts`

**Interfaces:**
- Consumes: fixtures from Task 2 (`test`, `expect`, `page`, `errors`); anchors from Task 3.
- Produces:
  - `CORE_VIEWS: ReadonlyArray<{ name: string; hash: string; testid: string }>`
  - `class AppShell { constructor(page: Page); goto(hash: string): Promise<void> }`
  - `class UnlockPage { constructor(page: Page); createVaultAndEnter(): Promise<void> }`

- [ ] **Step 1: Write the view matrix**

Create `e2e/pages/view-matrix.ts`:

```ts
/**
 * The core views the smoke/UX pass covers. Adding a view later = add a row
 * here plus its `data-testid` root — no new spec file. Order starts at
 * `/settings` because `/` redirects there after unlock.
 */
export const CORE_VIEWS = [
  { name: 'settings', hash: '#/settings', testid: 'view-settings-root' },
  { name: 'identity', hash: '#/identity', testid: 'view-identity-root' },
  { name: 'credentials', hash: '#/credentials', testid: 'view-credentials-root' },
  { name: 'pdf', hash: '#/pdf', testid: 'view-pdf-root' },
  { name: 'cedula', hash: '#/verify/cr/cedula', testid: 'view-cedula-root' },
] as const
```

- [ ] **Step 2: Write the AppShell page object**

Create `e2e/pages/app-shell.ts`:

```ts
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
```

- [ ] **Step 3: Write the UnlockPage page object**

Create `e2e/pages/unlock-page.ts`:

```ts
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
```

- [ ] **Step 4: Write the core-flow spec**

Create `e2e/core-flow.spec.ts`:

```ts
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
```

- [ ] **Step 5: Run the core-flow spec**

Run: `pnpm test:e2e e2e/core-flow.spec.ts`
Expected: `1 passed`. If the cédula view's camera auto-start produces a console error, the `--use-fake-device-for-media-stream` flag (already set in the fixture) should suppress it; if a benign warning still appears, add its pattern to `IGNORED_ERROR_PATTERNS` in `e2e/fixtures.ts` — never to the spec.

- [ ] **Step 6: Run the whole E2E suite**

Run: `pnpm test:e2e`
Expected: `2 passed` (smoke + core-flow).

- [ ] **Step 7: Commit**

```bash
git add e2e/pages/view-matrix.ts e2e/pages/app-shell.ts e2e/pages/unlock-page.ts e2e/core-flow.spec.ts
git commit -m "test(e2e): POM + core-flow spec across the five core views"
```

---

## Verification (whole harness)

- [ ] `pnpm test` → 78 unit tests still pass.
- [ ] `pnpm test:e2e` → 2 specs pass on a clean checkout, offline (Wi-Fi off is a fair test — mesh is skipped).
- [ ] Launch normally (`pnpm dev`, `ATTESTTO_E2E` unset) → mesh still starts (log shows `[mesh] Node started`), confirming the guard is inert outside E2E.
- [ ] Temporarily add `throw new Error('e2e-canary')` to `SettingsPage.vue` `onMounted`, run `pnpm test:e2e` → core-flow FAILS on the `errors` assertion (proves the collector has teeth), then revert.
