import { app, BrowserWindow, shell, Tray, Menu, nativeImage, safeStorage } from 'electron'
import { join } from 'node:path'
import { registerMeshIPC, unregisterMeshIPC } from './mesh/ipc'
import { meshService } from './mesh/service'
import { initCoreUpdater, unregisterCoreUpdater } from './updater/core-updater'
import { registerModuleIPC, unregisterModuleIPC } from './modules/module-loader'
import { registerVaultIPC, unregisterVaultIPC } from './vault/vault-ipc'
import { vaultService } from './vault/vault-service'
import { registerGuardianIPC, unregisterGuardianIPC } from './vault/guardian-ipc'
import { registerPadronIPC, closePadronService } from './padron/padron-ipc'
import { registerCaptureIPC, closeCaptureServer } from './capture/capture-ipc'
import { registerFirmaIPC, unregisterFirmaIPC } from './pki/firma-ipc'
import { registerPdfIPC, unregisterPdfIPC } from './pdf/pdf-ipc'
import { registerStationIPC, unregisterStationIPC } from './station/station-ipc'
import { stationService } from './station/station-service'

const isDev = !app.isPackaged

// Set app name for macOS menu bar (overrides "Electron" in dev)
app.setName('Attestto')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// ── Window ───────────────────────────────────────────

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')

  // Set dock icon on macOS (especially for dev mode)
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(iconPath)
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'Attestto',
    icon: iconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f1923',
    show: false,
    movable: true,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for camera access
    },
  })

  // Show when ready to avoid white flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Lock vault when renderer reloads (Cmd+R / F5)
  // Skip the initial load — only lock on subsequent navigations
  let initialLoadDone = false
  mainWindow.webContents.on('did-finish-load', () => {
    if (initialLoadDone) {
      vaultService.lock()
    } else {
      initialLoadDone = true
    }
  })

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    // electron-vite dev server (`pnpm dev`) injects ELECTRON_RENDERER_URL.
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Built renderer — used by `pnpm preview` and packaged builds.
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── System Tray ──────────────────────────────────────

function createTray(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })

  tray = new Tray(icon)
  tray.setToolTip('Attestto')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Presencia',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      },
    },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ── App Lifecycle ────────────────────────────────────

app.whenReady().then(async () => {
  // Warm up safeStorage so macOS Keychain prompts ONCE, before both
  // vault-service and station-keys try to decrypt independently.
  if (safeStorage.isEncryptionAvailable()) {
    try {
      safeStorage.encryptString('warmup')
    } catch { /* swallow — just triggering the Keychain prompt */ }
  }

  createWindow()
  createTray()

  if (mainWindow) {
    // Register IPC handlers
    registerMeshIPC(mainWindow)
    registerModuleIPC()
    registerVaultIPC(mainWindow)
    registerGuardianIPC()
    registerPadronIPC()
    registerCaptureIPC(mainWindow)
    registerFirmaIPC()
    registerPdfIPC(mainWindow)

    // Station identity — generate the per-install signing keypair on first
    // launch, register IPC. This must run BEFORE any code path that signs a
    // credential. See `project_attestto_pay_model.md` for the architectural
    // role of the station signing key.
    try {
      stationService.init()
      registerStationIPC()
      console.log('[station] Identity ready —', stationService.getStationDid().sns)
    } catch (err) {
      console.error('[station] Failed to initialize:', err)
    }

    // Core auto-updater (only in production — dev uses HMR)
    if (!isDev) {
      initCoreUpdater(mainWindow)
    }

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
  }

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// macOS: keep app running when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Graceful shutdown: stop mesh before quitting
app.on('before-quit', async () => {
  unregisterMeshIPC()
  unregisterCoreUpdater()
  unregisterModuleIPC()
  unregisterVaultIPC()
  unregisterGuardianIPC()
  unregisterFirmaIPC()
  unregisterPdfIPC()
  unregisterStationIPC()
  closePadronService()
  closeCaptureServer()
  try {
    await meshService.stop()
    console.log('[mesh] Node stopped')
  } catch (err) {
    console.error('[mesh] Error stopping:', err)
  }
})

// Security: prevent new webview/window creation
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173'
    const allowed = isDev
      ? url.startsWith(rendererUrl) || url.startsWith('http://localhost:')
      : url.startsWith('file://')

    if (!allowed) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
})
