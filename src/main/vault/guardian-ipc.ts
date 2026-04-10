import { ipcMain } from 'electron'
import { guardianService } from './guardian-service'
import { vaultService } from './vault-service'
import type { GuardianSetupParams, GuardianRecoverParams } from '../../shared/vault-api'

/**
 * Register guardian IPC handlers. Call once during app initialization.
 */
export function registerGuardianIPC(): void {
  ipcMain.handle(
    'guardian:setup',
    async (_event, params: GuardianSetupParams) => {
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

  ipcMain.handle('guardian:backup', async () => {
    return guardianService.backup()
  })

  ipcMain.handle(
    'guardian:recover',
    async (_event, params: GuardianRecoverParams): Promise<boolean> => {
      return guardianService.recover(
        params.passphrase,
        params.userDid,
        params.guardianDids,
      )
    },
  )

  ipcMain.handle('guardian:status', async () => {
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
