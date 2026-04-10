/**
 * Shared types for the Mesh IPC contract.
 * Used by main process (handlers), preload (bridge), and renderer (consumer).
 */

export interface MeshPutParams {
  didOwner: string
  path: string
  version: number
  ttlSeconds?: number
  signature: string
  blob: Uint8Array
}

export interface MeshPutResult {
  contentHash: string
}

export interface MeshGetParams {
  didOwner: string
  path: string
}

export interface MeshGetResult {
  metadata: {
    contentHash: string
    didOwner: string
    path: string
    version: number
    createdAt: number
    sizeBytes: number
    signature: string
    solanaAnchor: { txHash: string; slot: number; timestamp: number } | null
  }
  blob: Uint8Array
}

export interface MeshTombstoneParams {
  didOwner: string
  signature: string
}

export interface MeshStatusResult {
  running: boolean
  peerId: string | null
  peerCount: number
  dhtReady: boolean
  uptimeMs: number
  storage: {
    itemCount: number
    usedBytes: number
    limitBytes: number
    percentage: number
  }
  level: 'anchor' | 'pro' | 'standard' | 'light'
}

export type MeshEventPayload =
  | { type: 'peer:connected'; peerId: string }
  | { type: 'peer:disconnected'; peerId: string }
  | { type: 'item:received'; contentHash: string; didOwner: string; path: string }
  | { type: 'item:stored'; contentHash: string }
  | { type: 'item:evicted'; contentHash: string; reason: string }
  | { type: 'storage:pressure'; percentage: number }
  | { type: 'gc:completed'; itemsPruned: number; bytesFreed: number }
  | { type: 'conflict:resolved'; key: string; winnerVersion: number; reason: string }

/** The mesh API exposed to the renderer via contextBridge */
export interface MeshAPI {
  start(): Promise<void>
  stop(): Promise<void>
  status(): Promise<MeshStatusResult>
  put(params: MeshPutParams): Promise<MeshPutResult>
  get(params: MeshGetParams): Promise<MeshGetResult | null>
  tombstone(params: MeshTombstoneParams): Promise<void>
  onEvent(callback: (event: MeshEventPayload) => void): () => void
}

// ── Core Updater Types ─────────────────────────────

export interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateAPI {
  check(): Promise<void>
  download(): Promise<void>
  install(): void
  onChecking(cb: () => void): () => void
  onAvailable(cb: (info: UpdateInfo) => void): () => void
  onNotAvailable(cb: () => void): () => void
  onProgress(cb: (progress: UpdateProgress) => void): () => void
  onDownloaded(cb: (info: { version: string }) => void): () => void
  onError(cb: (err: { message: string }) => void): () => void
}

// ── Country Module Types ───────────────────────────

export interface CountryModuleManifest {
  id: string
  name: string
  version: string
  country: string
  description: string
  author: string
  updatedAt: string
  registryUrl?: string
  integrity?: string
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

export interface ModulesAPI {
  list(): Promise<InstalledModule[]>
  install(params: { manifest: CountryModuleManifest; payload: Record<string, unknown> }): Promise<void>
  uninstall(moduleId: string): Promise<void>
  checkUpdates(registryUrl: string): Promise<RegistryEntry[]>
  download(entry: RegistryEntry): Promise<CountryModuleManifest>
}

// ── Vault + Guardian Types (re-exported) ───────────

export type {
  VaultAPI,
  GuardianAPI,
  VaultContents,
  VaultStatus,
  VaultCreateParams,
  VaultUnlockParams,
  GuardianSetupParams,
  GuardianRecoverParams,
  GuardianBackupResult,
  VaultGuardians,
} from './vault-api'

/** The full preload API exposed to the renderer */
export interface PresenciaAPI {
  isElectron: true
  appVersion: string
  platform: string
  appName: string
  mesh: MeshAPI
  update: UpdateAPI
  modules: ModulesAPI
  vault: import('./vault-api').VaultAPI
  guardian: import('./vault-api').GuardianAPI
}

declare global {
  interface Window {
    presenciaAPI: PresenciaAPI
  }
}
