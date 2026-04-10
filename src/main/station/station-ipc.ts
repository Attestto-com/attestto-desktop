import { ipcMain } from 'electron'
import { stationService } from './station-service'
import type {
  StationInfo,
  PairwiseProofWire,
  StationSignCredentialParams,
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

  // Sign a credential body with a fresh pairwise sub-key.
  // The renderer must canonicalize the credential body itself before passing
  // the bytes here — the main process does NOT make canonicalization decisions
  // because that's a credential-schema concern.
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
}

export function unregisterStationIPC(): void {
  ipcMain.removeHandler('station:info')
  ipcMain.removeHandler('station:sign-credential')
}
