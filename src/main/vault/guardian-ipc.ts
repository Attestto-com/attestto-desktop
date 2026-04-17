import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { guardianService } from './guardian-service'
import { vaultService } from './vault-service'
import type { GuardianSetupParams, GuardianRecoverParams } from '../../shared/vault-api'

/** Validate that an IPC call originates from our own renderer, not a rogue frame. */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (url.startsWith('file://') || url.startsWith('http://localhost')) return
  throw new Error(`IPC rejected: untrusted sender origin ${url}`)
}

/**
 * Register guardian IPC handlers. Call once during app initialization.
 */
export function registerGuardianIPC(): void {
  ipcMain.handle(
    'guardian:setup',
    async (event, params: GuardianSetupParams) => {
      assertTrustedSender(event)
      const contents = vaultService.read()
      if (!contents) throw new Error('Vault is locked')

      vaultService.write({
        guardians: {
          configured: true,
          threshold: 2,
          guardianDids: params.guardianDids,
          backupVersion: contents.guardians.backupVersion,
          lastBackupAt: contents.guardians.lastBackupAt,
        },
      })
    },
  )

  ipcMain.handle('guardian:backup', async (event) => {
    assertTrustedSender(event)
    return guardianService.backup()
  })

  ipcMain.handle(
    'guardian:recover',
    async (event, params: GuardianRecoverParams): Promise<boolean> => {
      assertTrustedSender(event)
      return guardianService.recover(
        params.passphrase,
        params.userDid,
        params.guardianDids,
      )
    },
  )

  ipcMain.handle('guardian:status', async (event) => {
    assertTrustedSender(event)
    const contents = vaultService.read()
    return contents?.guardians ?? null
  })
}

export function unregisterGuardianIPC(): void {
  ipcMain.removeHandler('guardian:setup')
  ipcMain.removeHandler('guardian:backup')
  ipcMain.removeHandler('guardian:recover')
  ipcMain.removeHandler('guardian:status')
}
