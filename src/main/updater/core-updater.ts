import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { ipcMain, type BrowserWindow } from 'electron'

/**
 * Core App Updater — handles binary updates via GitHub Releases.
 *
 * Model 3: Core app (mesh protocol, crypto, libp2p) updates from a single
 * channel. Country-specific modules update independently.
 *
 * Flow:
 * 1. App launches → checks GitHub Releases for newer version
 * 2. If found → notifies renderer via IPC
 * 3. User confirms → downloads + installs on next restart
 */
export function initCoreUpdater(mainWindow: BrowserWindow): void {
  // Don't auto-download — let the user confirm
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // ── Events → Renderer ──────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : undefined,
    })
  })

  autoUpdater.on('update-not-available', () => {
    send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    send('update:progress', {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    send('update:error', { message: err.message })
  })

  // ── IPC Handlers (renderer → main) ────────────────

  ipcMain.handle('update:check', async () => {
    return autoUpdater.checkForUpdates()
  })

  ipcMain.handle('update:download', async () => {
    return autoUpdater.downloadUpdate()
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  // ── Auto-check on launch ──────────────────────────

  // Delay check by 10s to not block app startup
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silent fail — user can manually check later
    })
  }, 10_000)

  function send(channel: string, data?: unknown): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }
}

export function unregisterCoreUpdater(): void {
  ipcMain.removeHandler('update:check')
  ipcMain.removeHandler('update:download')
  ipcMain.removeHandler('update:install')
}
