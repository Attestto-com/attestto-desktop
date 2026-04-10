// ── Capture IPC Handlers ──
// Exposes the local capture server to the renderer process.

import { ipcMain, BrowserWindow } from 'electron'
import { CaptureServer } from './capture-server'
import { vaultService } from '../vault/vault-service'

let captureServer: CaptureServer | null = null

export function registerCaptureIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle('capture:start-server', async () => {
    if (!captureServer) {
      captureServer = new CaptureServer()
    }
    // Pass the user's DID to embed in the self-signed cert
    const did = vaultService.getDid() || undefined
    const port = await captureServer.start(did)

    // Forward events to renderer
    captureServer.onEvent((event) => {
      mainWindow.webContents.send('capture:event', event)
    })

    return { port }
  })

  ipcMain.handle('capture:create-session', async () => {
    if (!captureServer) {
      throw new Error('Capture server not started')
    }
    return captureServer.createSession()
  })

  ipcMain.handle('capture:get-session', async (_event, sessionId: string) => {
    if (!captureServer) return null
    const session = captureServer.getSession(sessionId)
    if (!session) return null
    // Don't send the ws reference over IPC
    return {
      id: session.id,
      status: session.status,
      frontImage: session.frontImage,
      backImage: session.backImage,
      extractedData: session.extractedData,
    }
  })

  ipcMain.handle('capture:stop-server', async () => {
    captureServer?.stop()
    captureServer = null
  })
}

export function closeCaptureServer(): void {
  captureServer?.stop()
  captureServer = null
}
