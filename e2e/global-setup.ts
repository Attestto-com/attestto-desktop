import { execSync } from 'node:child_process'

/**
 * Build the app once before the E2E suite so specs launch against a fresh
 * `out/` (main + preload + renderer). `pnpm build` runs `prebuild` →
 * `build:deps` (verify + mesh) then `electron-vite build`.
 */
export default function globalSetup(): void {
  execSync('pnpm build', { stdio: 'inherit' })
}
