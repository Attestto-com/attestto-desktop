import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { vaultService } from './vault-service'
import type { VaultStatus, EncryptedArtifact } from '../../shared/vault-api'

/** Validate that an IPC call originates from our own renderer, not a rogue frame. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  // Allow our app pages (file:// in production, localhost dev server)
  if (url.startsWith('file://') || url.startsWith('http://localhost')) return
  throw new Error(`IPC rejected: untrusted sender origin ${url}`)
}

/**
 * Register vault IPC handlers.
 */
export function registerVaultIPC(mainWindow: BrowserWindow): void {
  // Create vault — no passphrase, key protected by OS keychain
  ipcMain.handle('vault:create', async (event) => {
    assertTrustedSender(event)
    const contents = await vaultService.create()
    return { did: contents.identity.did }
  })

  // Unlock — biometric (Touch ID) + OS keychain
  ipcMain.handle('vault:unlock', async (event): Promise<boolean> => {
    assertTrustedSender(event)
    return vaultService.unlock()
  })

  ipcMain.handle('vault:lock', async (event) => {
    assertTrustedSender(event)
    vaultService.lock()
  })

  ipcMain.handle('vault:exists', async (event): Promise<boolean> => {
    assertTrustedSender(event)
    return vaultService.exists()
  })

  ipcMain.handle('vault:read', async (event) => {
    assertTrustedSender(event)
    return vaultService.read()
  })

  ipcMain.handle('vault:write', async (event, data: Record<string, unknown>) => {
    assertTrustedSender(event)
    vaultService.write(data)
  })

  // Inner-encrypt one artifact (image bytes, face descriptor) for storage
  // inside a VerificationSession. Vault key never leaves the main process.
  ipcMain.handle(
    'vault:encrypt-artifact',
    async (
      event,
      params: { plaintext: Uint8Array; mediaType: string; hashHex: string; info: string },
    ): Promise<EncryptedArtifact> => {
      assertTrustedSender(event)
      // IPC marshalling turns Uint8Array into a plain object on some Electron
      // versions; rebuild it defensively.
      const bytes = params.plaintext instanceof Uint8Array
        ? params.plaintext
        : new Uint8Array(Object.values(params.plaintext as Record<string, number>))
      return vaultService.encryptArtifact(bytes, params.mediaType, params.hashHex, params.info)
    },
  )

  // Decrypt for auditor inspection (UI to come; ticket #11b territory)
  ipcMain.handle(
    'vault:decrypt-artifact',
    async (event, params: { artifact: EncryptedArtifact; info: string }): Promise<Uint8Array> => {
      assertTrustedSender(event)
      return vaultService.decryptArtifact(params.artifact, params.info)
    },
  )

  // Sign arbitrary bytes with the vault's ed25519 identity key.
  // Marshalled bytes need defensive rebuild on some Electron versions.
  ipcMain.handle(
    'vault:sign',
    async (event, params: { message: Uint8Array }): Promise<Uint8Array> => {
      assertTrustedSender(event)
      const bytes = params.message instanceof Uint8Array
        ? params.message
        : new Uint8Array(Object.values(params.message as Record<string, number>))
      return vaultService.sign(bytes)
    },
  )

  ipcMain.handle('vault:status', async (event): Promise<VaultStatus> => {
    assertTrustedSender(event)
    const contents = vaultService.read()
    return {
      exists: vaultService.exists(),
      unlocked: vaultService.isUnlocked,
      did: vaultService.getDid(),
      lastBackupAt: contents?.guardians.lastBackupAt,
    }
  })

  // Forward auto-lock event to renderer
  vaultService.onLock(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault:locked')
    }
  })
}

export function unregisterVaultIPC(): void {
  ipcMain.removeHandler('vault:create')
  ipcMain.removeHandler('vault:unlock')
  ipcMain.removeHandler('vault:lock')
  ipcMain.removeHandler('vault:exists')
  ipcMain.removeHandler('vault:read')
  ipcMain.removeHandler('vault:write')
  ipcMain.removeHandler('vault:status')
  ipcMain.removeHandler('vault:encrypt-artifact')
  ipcMain.removeHandler('vault:decrypt-artifact')
  ipcMain.removeHandler('vault:sign')
}
