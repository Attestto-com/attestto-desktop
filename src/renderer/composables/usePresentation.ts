/**
 * VP Presentation composable — builds a W3C Verifiable Presentation
 * from vault credentials, signed with the vault's Ed25519 key via IPC.
 *
 * Uses the existing `vault:sign` IPC channel (raw detached Ed25519).
 * The private key never leaves the main process.
 */

import { ref } from 'vue'
import { canonicalize } from '../../shared/jcs'
import type { VaultCredential } from '../../shared/vault-api'

export interface VerifiablePresentation {
  '@context': string[]
  type: string[]
  holder: string
  verifiableCredential: VaultCredential[]
  proof: {
    type: string
    created: string
    verificationMethod: string
    proofPurpose: string
    proofValue: string
    nonce?: string
    domain?: string
  }
}

export interface PresentOptions {
  credential: VaultCredential
  nonce?: string
  domain?: string
}

export function usePresentation() {
  const presenting = ref(false)
  const error = ref('')

  async function buildSignedPresentation(options: PresentOptions): Promise<VerifiablePresentation | null> {
    presenting.value = true
    error.value = ''

    try {
      const api = (window as any).presenciaAPI
      if (!api?.vault?.sign || !api?.vault?.read) {
        throw new Error('Vault IPC not available')
      }

      // Get holder DID
      const contents = await api.vault.read()
      if (!contents?.identity?.did) {
        throw new Error('No identity in vault')
      }

      const holderDid: string = contents.identity.did
      const nonce = options.nonce || globalThis.crypto.randomUUID()
      const created = new Date().toISOString()

      // Build VP envelope (unsigned)
      const vpBody = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holderDid,
        verifiableCredential: [options.credential],
      }

      // Canonical proof input for signing
      const proofInput = {
        '@context': vpBody['@context'],
        type: 'Ed25519Signature2020',
        created,
        verificationMethod: `${holderDid}#key-1`,
        proofPurpose: 'authentication',
        nonce,
        domain: options.domain,
        // Include VP hash for binding
        vpHash: await hashObject(vpBody),
      }

      // JCS-canonicalize and sign via vault IPC (RFC 8785)
      const proofBytes = new TextEncoder().encode(canonicalize(proofInput))
      const signatureBytes: Uint8Array = await api.vault.sign(proofBytes)

      // Base64url encode the signature
      const proofValue = uint8ToBase64url(signatureBytes)

      const vp: VerifiablePresentation = {
        ...vpBody,
        proof: {
          type: 'Ed25519Signature2020',
          created,
          verificationMethod: `${holderDid}#key-1`,
          proofPurpose: 'authentication',
          proofValue,
          nonce,
          domain: options.domain,
        },
      }

      return vp
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      presenting.value = false
    }
  }

  return { buildSignedPresentation, presenting, error }
}

// Helpers

async function hashObject(obj: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return uint8ToHex(new Uint8Array(hashBuffer))
}

function uint8ToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
