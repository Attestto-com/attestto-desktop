/**
 * IPC bridge for the Firma Digital validator.
 *
 * Channels:
 *   firma:validate-pkcs7   — validate a PKCS#7 hex blob, returns FirmaValidationResult
 *   firma:roots-loaded     — true once at least one BCCR root has been bundled
 */

import { ipcMain } from 'electron'
import { loadTrustAnchors, rootsLoaded, validatePkcs7 } from './firma-validator'
import type { FirmaValidationResult } from '../../shared/firma-api'

export function registerFirmaIPC(): void {
  // Idempotent — load once on registration. Subsequent calls are cheap (file scan).
  loadTrustAnchors()

  ipcMain.handle('firma:validate-pkcs7', async (_event, pkcs7Hex: string): Promise<FirmaValidationResult> => {
    if (typeof pkcs7Hex !== 'string' || pkcs7Hex.length === 0) {
      return {
        trusted: false,
        chain: { status: 'parse-error', reason: 'pkcs7Hex must be a non-empty string' },
        ocsp: { status: 'not-checked', reason: 'invalid input' },
        summary: 'Entrada invalida',
        diagnostics: ['ipc input was not a non-empty string'],
      }
    }
    try {
      const result = await validatePkcs7(pkcs7Hex)
      console.log('[firma] validation result:', JSON.stringify({
        trusted: result.trusted,
        chain: result.chain,
        summary: result.summary,
        diagnostics: result.diagnostics,
      }, null, 2))
      return result
    } catch (err) {
      console.error('[firma] validatePkcs7 threw:', err)
      return {
        trusted: false,
        chain: { status: 'parse-error', reason: (err as Error).message },
        ocsp: { status: 'not-checked', reason: 'validator threw' },
        summary: 'Error interno del validador',
        diagnostics: [(err as Error).message],
      }
    }
  })

  ipcMain.handle('firma:roots-loaded', async (): Promise<boolean> => {
    return rootsLoaded()
  })
}

export function unregisterFirmaIPC(): void {
  ipcMain.removeHandler('firma:validate-pkcs7')
  ipcMain.removeHandler('firma:roots-loaded')
}
