import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

/**
 * Country Module Loader — manages country-specific modules independently of core updates.
 *
 * Model 3: Each country publishes modules (schemas, integrations, UI configs)
 * to a registry. The app downloads and loads them at runtime.
 *
 * Module storage: {userData}/modules/{moduleId}/
 *   ├── manifest.json   — ModuleManifest (name, version, country, etc.)
 *   └── payload.json    — Module-specific data (schemas, config, translations)
 *
 * Registry: a simple JSON endpoint that lists available modules per country.
 * Countries host their own registry or use the default Attestto registry.
 */

export interface CountryModuleManifest {
  id: string
  name: string
  version: string
  country: string           // ISO 3166-1 alpha-2 (e.g., 'CR', 'PA')
  description: string
  author: string
  updatedAt: string         // ISO date
  registryUrl?: string      // Where to check for updates
  integrity?: string        // SHA-256 of payload for verification
}

export interface InstalledModule {
  manifest: CountryModuleManifest
  payload: Record<string, unknown>
  installedAt: string
}

export interface RegistryEntry {
  id: string
  name: string
  version: string
  country: string
  description: string
  downloadUrl: string
  integrity: string
  updatedAt: string
}

const MODULES_DIR = (): string => join(app.getPath('userData'), 'modules')

// ── File Operations ────────────────────────────────

async function ensureModulesDir(): Promise<void> {
  const dir = MODULES_DIR()
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

async function listInstalled(): Promise<InstalledModule[]> {
  await ensureModulesDir()
  const dir = MODULES_DIR()
  const entries = await readdir(dir, { withFileTypes: true })
  const modules: InstalledModule[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const manifestPath = join(dir, entry.name, 'manifest.json')
      const payloadPath = join(dir, entry.name, 'payload.json')

      if (!existsSync(manifestPath)) continue

      const manifest: CountryModuleManifest = JSON.parse(
        await readFile(manifestPath, 'utf-8'),
      )
      const payload = existsSync(payloadPath)
        ? JSON.parse(await readFile(payloadPath, 'utf-8'))
        : {}

      modules.push({
        manifest,
        payload,
        installedAt: entry.name, // directory name = module id
      })
    } catch {
      // Skip corrupt modules
    }
  }

  return modules
}

async function installModule(
  manifest: CountryModuleManifest,
  payload: Record<string, unknown>,
): Promise<void> {
  await ensureModulesDir()
  const moduleDir = join(MODULES_DIR(), manifest.id)

  if (!existsSync(moduleDir)) {
    await mkdir(moduleDir, { recursive: true })
  }

  await writeFile(
    join(moduleDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
  await writeFile(
    join(moduleDir, 'payload.json'),
    JSON.stringify(payload, null, 2),
  )
}

async function uninstallModule(moduleId: string): Promise<void> {
  const moduleDir = join(MODULES_DIR(), moduleId)
  if (existsSync(moduleDir)) {
    await rm(moduleDir, { recursive: true })
  }
}

// ── IPC Registration ───────────────────────────────

export function registerModuleIPC(): void {
  ipcMain.handle('modules:list', async () => {
    return listInstalled()
  })

  ipcMain.handle(
    'modules:install',
    async (
      _event,
      params: { manifest: CountryModuleManifest; payload: Record<string, unknown> },
    ) => {
      await installModule(params.manifest, params.payload)
    },
  )

  ipcMain.handle('modules:uninstall', async (_event, moduleId: string) => {
    await uninstallModule(moduleId)
  })

  ipcMain.handle(
    'modules:check-updates',
    async (_event, registryUrl: string) => {
      // Fetch registry and compare versions with installed modules
      const installed = await listInstalled()
      const response = await fetch(registryUrl)
      if (!response.ok) return []

      const registry: RegistryEntry[] = await response.json()
      const updates: RegistryEntry[] = []

      for (const entry of registry) {
        const local = installed.find((m) => m.manifest.id === entry.id)
        if (!local || local.manifest.version !== entry.version) {
          updates.push(entry)
        }
      }

      return updates
    },
  )

  ipcMain.handle(
    'modules:download',
    async (_event, entry: RegistryEntry) => {
      // Download module from registry
      const response = await fetch(entry.downloadUrl)
      if (!response.ok) throw new Error(`Failed to download module: ${entry.id}`)

      const rawText = await response.text()

      // Verify payload integrity before installing
      const actualHash = createHash('sha256').update(rawText).digest('hex')
      if (actualHash !== entry.integrity) {
        throw new Error(
          `Module integrity check failed for ${entry.id}: ` +
          `expected ${entry.integrity}, got ${actualHash}`,
        )
      }

      const data = JSON.parse(rawText)
      const manifest: CountryModuleManifest = {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        country: entry.country,
        description: entry.description,
        author: '',
        updatedAt: entry.updatedAt,
        integrity: entry.integrity,
      }

      await installModule(manifest, data)
      return manifest
    },
  )
}

export function unregisterModuleIPC(): void {
  ipcMain.removeHandler('modules:list')
  ipcMain.removeHandler('modules:install')
  ipcMain.removeHandler('modules:uninstall')
  ipcMain.removeHandler('modules:check-updates')
  ipcMain.removeHandler('modules:download')
}
