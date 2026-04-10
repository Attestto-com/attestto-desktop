import { ipcMain, type BrowserWindow } from 'electron'
import { meshService } from './service'
import type {
  MeshPutParams,
  MeshGetParams,
  MeshTombstoneParams,
  MeshStatusResult,
  MeshPutResult,
  MeshGetResult,
} from '../../shared/mesh-api'

/**
 * Register all mesh IPC handlers.
 * Call once during app initialization.
 */
export function registerMeshIPC(mainWindow: BrowserWindow): void {
  // ── Lifecycle ──────────────────────────────────────

  ipcMain.handle('mesh:start', async () => {
    await meshService.start()
  })

  ipcMain.handle('mesh:stop', async () => {
    await meshService.stop()
  })

  // ── Status ─────────────────────────────────────────

  ipcMain.handle('mesh:status', async (): Promise<MeshStatusResult> => {
    if (!meshService.isRunning) {
      return {
        running: false,
        peerId: null,
        peerCount: 0,
        dhtReady: false,
        uptimeMs: 0,
        storage: { itemCount: 0, usedBytes: 0, limitBytes: 0, percentage: 0 },
        level: 'light',
      }
    }

    const node = meshService.getNode()
    const status = node.getStatus()

    return {
      running: true,
      peerId: status.peerId,
      peerCount: status.peerCount,
      dhtReady: status.dhtReady,
      uptimeMs: status.uptimeMs,
      storage: {
        itemCount: status.storage.itemCount,
        usedBytes: status.storage.usedBytes,
        limitBytes: status.storage.limitBytes,
        percentage: status.storage.percentage,
      },
      level: status.level,
    }
  })

  // ── Data Operations ────────────────────────────────

  ipcMain.handle(
    'mesh:put',
    async (_event, params: MeshPutParams): Promise<MeshPutResult> => {
      const protocol = meshService.getProtocol()
      const contentHash = await protocol.put(
        {
          didOwner: params.didOwner,
          path: params.path,
          version: params.version,
          ttlSeconds: params.ttlSeconds ?? 0,
          signature: params.signature,
          solanaAnchor: null,
        },
        params.blob,
      )
      return { contentHash }
    },
  )

  ipcMain.handle(
    'mesh:get',
    async (_event, params: MeshGetParams): Promise<MeshGetResult | null> => {
      const protocol = meshService.getProtocol()
      const result = await protocol.get(params.didOwner, params.path)
      if (!result) return null

      return {
        metadata: {
          contentHash: result.metadata.contentHash,
          didOwner: result.metadata.didOwner,
          path: result.metadata.path,
          version: result.metadata.version,
          createdAt: result.metadata.createdAt,
          sizeBytes: result.metadata.sizeBytes,
          signature: result.metadata.signature,
          solanaAnchor: result.metadata.solanaAnchor,
        },
        blob: result.blob,
      }
    },
  )

  ipcMain.handle(
    'mesh:tombstone',
    async (_event, params: MeshTombstoneParams): Promise<void> => {
      const protocol = meshService.getProtocol()
      await protocol.tombstone(params.didOwner, params.signature)
    },
  )

  // ── Event Forwarding ───────────────────────────────

  // Forward mesh events to the renderer via webContents.send
  meshService.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mesh:event', event)
    }
  })
}

/**
 * Remove all mesh IPC handlers.
 * Call during app shutdown.
 */
export function unregisterMeshIPC(): void {
  ipcMain.removeHandler('mesh:start')
  ipcMain.removeHandler('mesh:stop')
  ipcMain.removeHandler('mesh:status')
  ipcMain.removeHandler('mesh:put')
  ipcMain.removeHandler('mesh:get')
  ipcMain.removeHandler('mesh:tombstone')
}
