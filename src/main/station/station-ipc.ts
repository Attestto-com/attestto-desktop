import { ipcMain } from 'electron'
import { stationService } from './station-service'
import type {
  StationInfo,
  PairwiseProofWire,
  StationSignCredentialParams,
  StationPrepareResult,
  StationFinalizeParams,
  StationFinalizeResult,
} from '../../shared/station-api'

/**
 * Register station IPC handlers.
 *
 * The station signing key NEVER crosses the IPC boundary. Only:
 *   - public DIDs (strings)
 *   - public keys (base64 strings)
 *   - signatures (base64 strings)
 *
 * are returned to the renderer. The renderer cannot extract the master secret.
 */
export function registerStationIPC(): void {
  // Lightweight info — used by an "advanced" Mi cuenta panel that's currently
  // hidden by default. Safe to call from any renderer at any time.
  ipcMain.handle('station:info', async (): Promise<StationInfo> => {
    const dids = stationService.getStationDid()
    return {
      dids,
      publicKeyB64: Buffer.from(stationService.getPublicKey()).toString('base64'),
      createdAt: stationService.getCreatedAt(),
      stationId: stationService.getStationId(),
    }
  })

  // Sign a credential body with a fresh pairwise sub-key (legacy 1-step flow).
  // Kept for PDF signing where the issuer is known before signing.
  ipcMain.handle(
    'station:sign-credential',
    async (_e, params: StationSignCredentialParams): Promise<PairwiseProofWire> => {
      const messageBytes = new Uint8Array(Buffer.from(params.messageB64, 'base64'))
      const proof = stationService.signCredential(params.credentialId, messageBytes)
      return {
        subPublicKeyB64: Buffer.from(proof.subPublicKey).toString('base64'),
        proofValueB64: Buffer.from(proof.proofValue).toString('base64'),
        delegationProofB64: Buffer.from(proof.delegationProof).toString('base64'),
        delegationBindingB64: Buffer.from(proof.delegationBinding).toString('base64'),
        createdAt: proof.createdAt,
      }
    },
  )

  // 2-step flow (ATT-344): prepare sub-key → renderer builds body → finalize
  ipcMain.handle(
    'station:prepare-credential',
    async (_e, credentialId: string): Promise<StationPrepareResult> => {
      const prepared = stationService.prepareCredential(credentialId)
      return {
        subPublicKeyB64: Buffer.from(prepared.subPublicKey).toString('base64'),
        delegationProofB64: Buffer.from(prepared.delegationProof).toString('base64'),
        delegationBindingB64: Buffer.from(prepared.delegationBinding).toString('base64'),
        createdAt: prepared.createdAt,
      }
    },
  )

  ipcMain.handle(
    'station:finalize-credential',
    async (_e, params: StationFinalizeParams): Promise<StationFinalizeResult> => {
      const messageBytes = new Uint8Array(Buffer.from(params.messageB64, 'base64'))
      const proofValue = stationService.finalizeCredential(params.credentialId, messageBytes)
      return {
        proofValueB64: Buffer.from(proofValue).toString('base64'),
      }
    },
  )
}

export function unregisterStationIPC(): void {
  ipcMain.removeHandler('station:info')
  ipcMain.removeHandler('station:sign-credential')
  ipcMain.removeHandler('station:prepare-credential')
  ipcMain.removeHandler('station:finalize-credential')
}
