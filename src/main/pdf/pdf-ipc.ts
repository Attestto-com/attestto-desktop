/**
 * PDF IPC handlers — Attestto self-attested signing + save dialog.
 *
 * Lives in main so the vault private key never crosses the IPC boundary.
 * The renderer hands us bytes + display options, we orchestrate
 * vaultService.sign(), embed the signature, and hand bytes back.
 */
import { ipcMain, dialog, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { vaultService } from '../vault/vault-service'
import {
  signAttesttoPdf,
  verifyAttesttoPdf,
  type AttesttoPdfSignature,
  type VerifyAttesttoResult,
} from './pdf-attestto'

export interface PdfSignAttesttoParams {
  pdfBytes: Uint8Array
  fileName: string
  signerName?: string
  signerHandle?: string
  signerCountry?: string
  level: 'self-attested' | 'firma-digital-mocked'
  mode: 'final' | 'open'
  reason?: string
  location?: string
}

export interface PdfSignAttesttoResult {
  pdfBytes: Uint8Array
  originalHash: string
  signature: AttesttoPdfSignature
  /** ATT-355: which write path was taken; surfaces UX hint. */
  writeMode: 'full-rewrite' | 'incremental'
  /** ATT-355: true when visible stamp was suppressed to preserve a prior signature. */
  stampSuppressed: boolean
}

export interface PdfSaveParams {
  bytes: Uint8Array
  defaultFileName: string
}

export interface PdfSaveResult {
  cancelled: boolean
  path?: string
}

/** Defensively rebuild Uint8Array — IPC marshalling may flatten it. */
function asUint8(maybe: Uint8Array | Record<string, number>): Uint8Array {
  if (maybe instanceof Uint8Array) return maybe
  return new Uint8Array(Object.values(maybe))
}

export function registerPdfIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle(
    'pdf:sign-attestto',
    async (_event, params: PdfSignAttesttoParams): Promise<PdfSignAttesttoResult> => {
      const contents = vaultService.read()
      if (!contents) throw new Error('Vault is locked — unlock to sign')

      const pubkeyHex = contents.identity.publicKeyHex
      const pubkey = new Uint8Array(Buffer.from(pubkeyHex, 'hex'))

      const result = await signAttesttoPdf({
        pdfBytes: asUint8(params.pdfBytes),
        fileName: params.fileName,
        signerDid: contents.identity.did,
        signerName: params.signerName,
        signerHandle: params.signerHandle,
        signerCountry: params.signerCountry,
        signerPublicKey: pubkey,
        sign: async (message) => vaultService.sign(message),
        level: params.level,
        mode: params.mode,
        reason: params.reason,
        location: params.location,
      })

      return {
        pdfBytes: result.pdfBytes,
        originalHash: result.originalHash,
        signature: result.signature,
        writeMode: result.writeMode,
        stampSuppressed: result.stampSuppressed,
      }
    },
  )

  ipcMain.handle(
    'pdf:verify-attestto',
    async (_event, params: { pdfBytes: Uint8Array }): Promise<VerifyAttesttoResult | null> => {
      return verifyAttesttoPdf(asUint8(params.pdfBytes))
    },
  )

  ipcMain.handle(
    'pdf:save',
    async (_event, params: PdfSaveParams): Promise<PdfSaveResult> => {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar PDF firmado',
        defaultPath: params.defaultFileName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) {
        return { cancelled: true }
      }
      await writeFile(result.filePath, asUint8(params.bytes))
      return { cancelled: false, path: result.filePath }
    },
  )
}

export function unregisterPdfIPC(): void {
  ipcMain.removeHandler('pdf:sign-attestto')
  ipcMain.removeHandler('pdf:verify-attestto')
  ipcMain.removeHandler('pdf:save')
}

export type { AttesttoPdfSignature, VerifyAttesttoResult }
export { basename }
