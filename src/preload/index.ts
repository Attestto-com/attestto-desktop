import { contextBridge, ipcRenderer } from 'electron'
import type {
  MeshPutParams,
  MeshGetParams,
  MeshTombstoneParams,
  CountryModuleManifest,
  RegistryEntry,
} from '../shared/mesh-api'
import type {
  VaultCreateParams,
  VaultUnlockParams,
  GuardianSetupParams,
  GuardianRecoverParams,
  EncryptedArtifact,
} from '../shared/vault-api'
import type { FirmaValidationResult } from '../shared/firma-api'
import type {
  StationInfo,
  PairwiseProofWire,
  StationSignCredentialParams,
} from '../shared/station-api'

/**
 * Preload — bridge between renderer and Electron/Node APIs.
 * Keep surface area minimal. Feature-detect in renderer.
 */
contextBridge.exposeInMainWorld('presenciaAPI', {
  /** True when running inside Electron */
  isElectron: true,

  /** App version */
  appVersion: process.env.npm_package_version ?? '0.1.0',

  /** OS platform */
  platform: process.platform,

  /** App name */
  appName: 'Attestto',

  // ── Mesh P2P ─────────────────────────────────────

  mesh: {
    start: () => ipcRenderer.invoke('mesh:start'),
    stop: () => ipcRenderer.invoke('mesh:stop'),
    status: () => ipcRenderer.invoke('mesh:status'),
    put: (params: MeshPutParams) => ipcRenderer.invoke('mesh:put', params),
    get: (params: MeshGetParams) => ipcRenderer.invoke('mesh:get', params),
    tombstone: (params: MeshTombstoneParams) =>
      ipcRenderer.invoke('mesh:tombstone', params),

    onEvent: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload)
      ipcRenderer.on('mesh:event', handler)
      return () => ipcRenderer.removeListener('mesh:event', handler)
    },
  },

  // ── Core Updater ─────────────────────────────────

  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),

    onChecking: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('update:checking', handler)
      return () => ipcRenderer.removeListener('update:checking', handler)
    },
    onAvailable: (cb: (info: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: unknown) => cb(info)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },
    onNotAvailable: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('update:not-available', handler)
      return () => ipcRenderer.removeListener('update:not-available', handler)
    },
    onProgress: (cb: (progress: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p)
      ipcRenderer.on('update:progress', handler)
      return () => ipcRenderer.removeListener('update:progress', handler)
    },
    onDownloaded: (cb: (info: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: unknown) => cb(info)
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    },
    onError: (cb: (err: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, err: unknown) => cb(err)
      ipcRenderer.on('update:error', handler)
      return () => ipcRenderer.removeListener('update:error', handler)
    },
  },

  // ── Country Modules ──────────────────────────────

  modules: {
    list: () => ipcRenderer.invoke('modules:list'),
    install: (params: { manifest: CountryModuleManifest; payload: Record<string, unknown> }) =>
      ipcRenderer.invoke('modules:install', params),
    uninstall: (moduleId: string) =>
      ipcRenderer.invoke('modules:uninstall', moduleId),
    checkUpdates: (registryUrl: string) =>
      ipcRenderer.invoke('modules:check-updates', registryUrl),
    download: (entry: RegistryEntry) =>
      ipcRenderer.invoke('modules:download', entry),
  },

  // ── Vault ────────────────────────────────────────

  vault: {
    create: (params: VaultCreateParams) => ipcRenderer.invoke('vault:create', params),
    unlock: (params: VaultUnlockParams) => ipcRenderer.invoke('vault:unlock', params),
    lock: () => ipcRenderer.invoke('vault:lock'),
    exists: () => ipcRenderer.invoke('vault:exists'),
    read: () => ipcRenderer.invoke('vault:read'),
    write: (data: Record<string, unknown>) => ipcRenderer.invoke('vault:write', data),
    status: () => ipcRenderer.invoke('vault:status'),
    encryptArtifact: (params: {
      plaintext: Uint8Array
      mediaType: string
      hashHex: string
      info: string
    }): Promise<EncryptedArtifact> => ipcRenderer.invoke('vault:encrypt-artifact', params),
    decryptArtifact: (params: { artifact: EncryptedArtifact; info: string }): Promise<Uint8Array> =>
      ipcRenderer.invoke('vault:decrypt-artifact', params),
    sign: (message: Uint8Array): Promise<Uint8Array> =>
      ipcRenderer.invoke('vault:sign', { message }),

    onLocked: (cb: () => void): (() => void) => {
      const handler = () => cb()
      ipcRenderer.on('vault:locked', handler)
      return () => ipcRenderer.removeListener('vault:locked', handler)
    },
  },

  // ── Mobile Capture ──────────────────────────────

  capture: {
    startServer: () => ipcRenderer.invoke('capture:start-server'),
    createSession: () => ipcRenderer.invoke('capture:create-session'),
    getSession: (sessionId: string) => ipcRenderer.invoke('capture:get-session', sessionId),
    stopServer: () => ipcRenderer.invoke('capture:stop-server'),
    onEvent: (cb: (event: unknown) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, event: unknown) => cb(event)
      ipcRenderer.on('capture:event', handler)
      return () => ipcRenderer.removeListener('capture:event', handler)
    },
  },

  // ── Padrón Electoral (CR) ────────────────────────

  padron: {
    status: () => ipcRenderer.invoke('padron:status'),
    downloadCanton: (params: { zipFilename: string; cantonCode: string; cantonName: string }) =>
      ipcRenderer.invoke('padron:download-canton', params),
    lookup: (cedula: string) => ipcRenderer.invoke('padron:lookup', cedula),
    hasCanton: (cantonCode: string) => ipcRenderer.invoke('padron:has-canton', cantonCode),
  },

  // ── Guardian ─────────────────────────────────────

  guardian: {
    setup: (params: GuardianSetupParams) => ipcRenderer.invoke('guardian:setup', params),
    backup: () => ipcRenderer.invoke('guardian:backup'),
    recover: (params: GuardianRecoverParams) => ipcRenderer.invoke('guardian:recover', params),
    status: () => ipcRenderer.invoke('guardian:status'),
  },

  // ── Station identity ─────────────────────────────

  station: {
    info: (): Promise<StationInfo> => ipcRenderer.invoke('station:info'),
    signCredential: (params: StationSignCredentialParams): Promise<PairwiseProofWire> =>
      ipcRenderer.invoke('station:sign-credential', params),
  },

  // ── PDF — Attestto self-attested signing ─────────

  pdf: {
    signAttestto: (params: {
      pdfBytes: Uint8Array
      fileName: string
      signerName?: string
      signerHandle?: string
      signerCountry?: string
      level: 'self-attested' | 'firma-digital-mocked'
      mode: 'final' | 'open'
      reason?: string
      location?: string
    }): Promise<{
      pdfBytes: Uint8Array
      originalHash: string
      signature: unknown
      /** ATT-355: which write path the main process took. */
      writeMode: 'full-rewrite' | 'incremental'
      /** ATT-355: true when the visible stamp was suppressed to preserve a prior signature. */
      stampSuppressed: boolean
    }> =>
      ipcRenderer.invoke('pdf:sign-attestto', params),
    verifyAttestto: (params: { pdfBytes: Uint8Array }): Promise<unknown | null> =>
      ipcRenderer.invoke('pdf:verify-attestto', params),
    save: (params: { bytes: Uint8Array; defaultFileName: string }): Promise<{ cancelled: boolean; path?: string }> =>
      ipcRenderer.invoke('pdf:save', params),
  },

  // ── Firma Digital validator ──────────────────────

  firma: {
    validatePkcs7: (pkcs7Hex: string): Promise<FirmaValidationResult> =>
      ipcRenderer.invoke('firma:validate-pkcs7', pkcs7Hex),
    rootsLoaded: (): Promise<boolean> => ipcRenderer.invoke('firma:roots-loaded'),
  },
})
