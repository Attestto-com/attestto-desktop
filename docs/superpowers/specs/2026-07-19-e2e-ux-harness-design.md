# Electron E2E UX Automation Harness — Design

**Repo:** attestto-desktop
**Date:** 2026-07-19
**Status:** Approved (design), pending spec review

## Goal

Automate the manual UX pass on the real Electron app: launch the packaged
renderer, cross the vault-unlock gate, click through the primary views, and
fail the run on any renderer crash or uncaught error — turning the class of
bug we just saw in the dev log (a renderer sandbox `TypeError`) into a red
test instead of a silent console line.

## Scope

**In scope (first cut):**

- A Playwright-Electron harness driving the real app against the
  `electron-vite build` output.
- **Smoke spec:** app boots, main window appears, the `presenciaAPI` preload
  bridge is live, and no uncaught renderer error / crash occurs.
- **Core happy-path spec:** create + unlock a vault through the real `/unlock`
  UI with a test password, then navigate Identity → Credentials → Settings →
  Pdf → Verify (CR cédula), asserting each view renders and throws no error.
- One minimal production-code change: an `ATTESTTO_E2E` env guard that skips
  mesh startup so tests are offline and deterministic.
- Local-first, structured so a headless CI job can be added later.

**Out of scope (first cut):**

- Biometric / camera capture flows (Onboarding capture, exam proctoring).
- Exam lockdown, guardian setup/recovery, mesh peer flows, PDF signing round-trip.
- The GitHub Actions CI workflow itself (harness is CI-ready; workflow not wired).
- Any parallel/sharded execution (Electron runs sequentially).

## Constraints (from repo rules)

- Public repo (Apache-2.0): no PII, no private keys, no internal references in
  code or test fixtures. Test vault password is a non-secret constant.
- `CHANGELOG.md` MUST get a Keep-a-Changelog entry for every `src/` change
  (CI-enforced). The `ATTESTTO_E2E` guard change requires one.
- Do not weaken existing production behavior: the mesh guard is additive and
  gated strictly on `process.env.ATTESTTO_E2E === '1'`; normal launches are
  unaffected.
- Vault cipher / crypto behavior is untouched.

## Architecture

### How app state is isolated

The router enforces a three-layer guard (`vault exists? → unlocked? →
onboarding complete?`); every route bounces to `/unlock` until a vault is
created and unlocked. The app also auto-starts a libp2p mesh node on boot that
dials `mesh.attestto.net`. Three isolation mechanisms make runs deterministic:

1. **Ephemeral vault** — Electron natively honors the Chromium
   `--user-data-dir=<tmp>` switch. Each run points at a fresh temp dir, so the
   vault is created clean and the real user vault is never touched. **No
   app-code change.**
2. **Offline mesh** — a new `ATTESTTO_E2E=1` guard in `src/main/index.ts`
   skips `meshService.start()`. Combined with `MESH_BOOTSTRAP_PEERS=''` for
   defense in depth. **~5 lines, the only production-code touch.**
3. **Fake media** — for any view that calls `getUserMedia`, pass Chromium's
   `--use-fake-device-for-media-stream`. The core scope avoids capture views,
   so this is a safety default, not a load-bearing dependency.

### Components

- **`playwright.config.ts`** — one Electron test project; `trace: 'on-first-retry'`,
  `video: 'retain-on-failure'`; `fullyParallel: false`, `workers: 1`;
  `testDir: 'e2e'`. A `globalSetup` runs `electron-vite build` once so specs
  launch against fresh `out/`.
- **`e2e/fixtures.ts`** — exports a Playwright `test` extended with a
  `launchApp` fixture. Responsibilities: mkdtemp a temp userData dir; call
  `_electron.launch({ args: ['.', '--user-data-dir=<tmp>',
  '--use-fake-device-for-media-stream'], env: { ...process.env,
  ATTESTTO_E2E: '1', MESH_BOOTSTRAP_PEERS: '' } })`; wait for the first
  window; wire a `pageerror` + `console('error')` collector onto the page;
  yield `{ app, page, errors }`; on teardown close the app and rm the temp
  dir. A shared `expectNoRendererErrors(errors)` helper asserts the collector
  is empty.
- **`e2e/smoke.spec.ts`** — launches via fixture; asserts the window title /
  root element is present; evaluates `window.presenciaAPI?.isElectron === true`
  in the renderer; asserts `errors` is empty after settle.
- **`e2e/core-flow.spec.ts`** — launches via fixture; on `/unlock` creates a
  vault with the test password (drives the real create-vault UI), unlocks,
  then for each of Identity, Credentials, Settings, Pdf, Verify/cédula:
  navigate (via nav UI or `page.evaluate` router push), assert a stable
  per-view anchor (heading text or a `data-testid`) is visible, assert no new
  renderer errors.
- **`src/main/index.ts`** — wrap the mesh-start block in
  `if (process.env.ATTESTTO_E2E !== '1') { ... }`.
- **`package.json`** — add `"test:e2e": "playwright test"` and devDep
  `@playwright/test`. Existing `"test": "vitest run"` is unchanged; E2E stays a
  separate command so the fast unit suite is not slowed.

### Data flow

Playwright drives the actual rendered Quasar DOM using role/text selectors
(and adds `data-testid` anchors only where text is ambiguous). Assertions read
real rendered state — this is a true UX exercise, not a mock. The vault
password is a test constant; it protects an ephemeral throwaway vault.

### Error handling

Each spec attaches `page.on('pageerror', …)` and
`page.on('console', m => m.type()==='error' && …)` before navigation and fails
if either fires. Playwright's trace + video are retained on failure for
diagnosis. The `launchApp` teardown always runs (temp-dir cleanup) even when
an assertion throws.

### Testing (of the harness itself)

The harness is validated by running it: a green `pnpm test:e2e` on a clean
checkout is the acceptance signal. A deliberately-broken renderer (temporary
`throw` in a view, reverted) is used once during development to confirm the
error collector actually fails the run — proving the guard has teeth.

## Risks & mitigations

- **electron-vite build drift** — globalSetup rebuilds before the suite so
  tests never run against stale `out/`.
- **Selector brittleness** — prefer role/text; add `data-testid` only where
  needed; keep per-view anchors to one stable element each.
- **First-run timing** — fixture waits on `firstWindow()` and an explicit
  visible-element condition, never a fixed sleep.
- **Playwright browser download** — `@playwright/test` for Electron uses the
  app's own Chromium; no separate browser download is required for the
  `_electron` path.

## Acceptance criteria

1. `pnpm test:e2e` passes on a clean checkout, offline.
2. Smoke spec proves the `presenciaAPI` bridge and a crash-free boot.
3. Core-flow spec creates+unlocks a vault and renders all five core views
   with zero renderer errors.
4. Normal `pnpm dev` / `pnpm build` behavior is unchanged when `ATTESTTO_E2E`
   is unset (mesh still starts).
5. `CHANGELOG.md` has an `## [Unreleased]` entry for the `ATTESTTO_E2E` guard.
6. Existing `pnpm test` (vitest, 78 tests) still passes.
