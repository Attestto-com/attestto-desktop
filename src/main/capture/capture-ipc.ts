// ── Capture IPC Handlers ──
// Exposes the local capture server to the renderer process.

import { ipcMain } from 'electron'
import { CaptureServer } from './capture-server'
import { vaultService } from '../vault/vault-service'

let captureServer: CaptureServer | null = null

export function registerCaptureIPC(): void {
  ipcMain.handle('capture:start-server', async (event) => {
    if (!captureServer) {
      captureServer = new CaptureServer()
    }
    // Pass the user's DID to embed in the self-signed cert
    const did = vaultService.getDid() || undefined
    const port = await captureServer.start(did)

    // Forward events to the renderer that started the server. Bind to the
    // invoking webContents (live at call time), NOT a captured window ref —
    // the window can be closed and recreated (macOS `activate`), which would
    // leave a stale reference and throw "Object has been destroyed" on send.
    // The renderer re-invokes start-server each time it enters the capture
    // flow, so `event.sender` is always the current, live webContents.
    const sender = event.sender
    captureServer.onEvent((captureEvent) => {
      if (!sender.isDestroyed()) {
        sender.send('capture:event', captureEvent)
      }
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
