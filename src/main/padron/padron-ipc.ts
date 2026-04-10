// ── Padrón IPC Handlers ──
// Exposes TSE Padrón operations to the renderer process.

import { ipcMain } from 'electron'
import { PadronService } from './padron-service'

let padronService: PadronService | null = null

function getService(): PadronService {
  if (!padronService) {
    padronService = new PadronService()
    padronService.init()
  }
  return padronService
}

export function registerPadronIPC(): void {
  ipcMain.handle('padron:status', async () => {
    return getService().getStatus()
  })

  ipcMain.handle('padron:download-canton', async (_event, params: {
    zipFilename: string
    cantonCode: string
    cantonName: string
  }) => {
    const count = await getService().downloadCanton(
      params.zipFilename,
      params.cantonCode,
      params.cantonName,
    )
    return { recordCount: count }
  })

  ipcMain.handle('padron:lookup', async (_event, cedula: string) => {
    return getService().lookupCedula(cedula)
  })

  ipcMain.handle('padron:has-canton', async (_event, cantonCode: string) => {
    return getService().hasCantonData(cantonCode)
  })
}

export function closePadronService(): void {
  padronService?.close()
  padronService = null
}
