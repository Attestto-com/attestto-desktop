/**
 * Credential export (v1) — re-issue a self-attested credential to another
 * device's own did:key so that device becomes a first-class holder.
 *
 * The target (phone / extension) generates its own Ed25519 signing key (its
 * did:key) and sends the DID up the relay channel. The desktop re-signs the
 * credential's subject bound to that DID with the vault key (the issuer of the
 * self-attested layer). No private key ever leaves any device.
 *
 * This is the pragmatic v1 binding: each device holds its own re-issued copy.
 * The did:sns anchor upgrade later unifies devices under one identity with
 * user-key-authorized key registration (see project_did_sns_anchor_authority /
 * ENG "did:sns Anchor Authority"). Only self-attested (Nivel B) creds are
 * re-issued here — gov-verified layers wait for the anchor.
 */
import { ref } from 'vue'
import { canonicalize } from '../../shared/jcs'
import type { VaultCredential } from '../../shared/vault-api'

export interface ReissuedCredential {
  '@context': string[]
  type: string[]
  issuer: string
  issuanceDate: string
  credentialSubject: Record<string, unknown> & { id: string }
  /** Points back at the source credential this was re-issued from. */
  evidence?: { type: string; sourceType: string; reissuedBy: string }
  proof: {
    type: string
    created: string
    verificationMethod: string
    proofPurpose: string
    proofValue: string
  }
}

function uint8ToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256hex(obj: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return uint8ToHex(new Uint8Array(buf))
}

export function useCredentialExport() {
  const exporting = ref(false)
  const error = ref('')

  /**
   * Re-issue `credential` so it is held by `holderDid` (the target device's
   * did:key), signed by this vault. Returns null on failure.
   */
  async function reissueTo(
    holderDid: string,
    credential: VaultCredential,
  ): Promise<ReissuedCredential | null> {
    exporting.value = true
    error.value = ''
    try {
      const api = (window as unknown as { presenciaAPI?: any }).presenciaAPI
      if (!api?.vault?.sign || !api?.vault?.read) throw new Error('Vault IPC not available')
      if (!/^did:key:z/.test(holderDid)) throw new Error('DID del dispositivo inválido')

      const contents = await api.vault.read()
      const issuerDid: string | undefined = contents?.identity?.did
      if (!issuerDid) throw new Error('No identity in vault')

      const src = credential as VaultCredential & { credentialSubject?: Record<string, unknown>; type?: unknown }
      const types = Array.isArray(src.type) ? (src.type as string[]) : [String(src.type || 'VerifiableCredential')]
      const srcSubject = (src.credentialSubject as Record<string, unknown>) || {}

      const created = new Date().toISOString()
      const body = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: types.includes('VerifiableCredential') ? types : ['VerifiableCredential', ...types],
        issuer: issuerDid,
        issuanceDate: created,
        // Bind the subject to the target device's DID; carry over the data fields.
        credentialSubject: { ...srcSubject, id: holderDid },
        evidence: {
          type: 'ReissuedCredential',
          sourceType: types.find((t) => t !== 'VerifiableCredential') || 'VerifiableCredential',
          reissuedBy: issuerDid,
        },
      }

      const proofInput = {
        '@context': body['@context'],
        type: 'Ed25519Signature2020',
        created,
        verificationMethod: `${issuerDid}#key-1`,
        proofPurpose: 'assertionMethod',
        vcHash: await sha256hex(body),
      }
      const sig: Uint8Array = await api.vault.sign(new TextEncoder().encode(canonicalize(proofInput)))

      return {
        ...body,
        proof: {
          type: 'Ed25519Signature2020',
          created,
          verificationMethod: `${issuerDid}#key-1`,
          proofPurpose: 'assertionMethod',
          proofValue: uint8ToBase64url(sig),
        },
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      exporting.value = false
    }
  }

  return { reissueTo, exporting, error }
}
