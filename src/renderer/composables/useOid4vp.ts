/**
 * OID4VP composable — full verifier-initiated presentation flow.
 *
 * Steps:
 * 1. Parse authorization request (from QR scan or pasted URI)
 * 2. Match wallet credentials against DCQL query
 * 3. Show consent (caller handles UI)
 * 4. Build signed VP + direct_post body
 * 5. Submit to verifier response_uri
 */

import { ref } from 'vue'
import {
  parseAuthorizationRequest,
  isDirectPost,
  needsJarFetch,
  getRequestedCredentials,
  matchCredentials,
  buildDirectPostBody,
  encodeDirectPostBody,
} from '@attestto/vc-sdk'
import type {
  ParsedAuthorizationRequest,
  AuthorizationRequest,
  DcqlMatchResult,
  VerifiableCredential,
  VerifiablePresentation,
  DirectPostBody,
} from '@attestto/vc-sdk'
import type { VaultCredential } from '../../shared/vault-api'
import { canonicalize } from '../../shared/jcs'

export type OID4VPStep = 'idle' | 'scanning' | 'parsing' | 'consent' | 'signing' | 'submitting' | 'done' | 'error'

export interface ConsentInfo {
  clientId: string
  requestedTypes: Array<{ id: string; format: string; types?: string[] }>
  matchResult: DcqlMatchResult
  matchedCredentials: VaultCredential[]
}

export function useOid4vp() {
  const step = ref<OID4VPStep>('idle')
  const error = ref('')
  const consent = ref<ConsentInfo | null>(null)
  const resultVp = ref<VerifiablePresentation | null>(null)

  // Internal state
  let parsedRequest: ParsedAuthorizationRequest | null = null
  let walletCredentials: VaultCredential[] = []
  let matchResult: DcqlMatchResult | null = null

  function reset() {
    step.value = 'idle'
    error.value = ''
    consent.value = null
    resultVp.value = null
    parsedRequest = null
    walletCredentials = []
    matchResult = null
  }

  /**
   * Step 1: Parse an OID4VP authorization request URI.
   * Returns consent info for the UI to display.
   */
  async function parseRequest(uri: string): Promise<ConsentInfo | null> {
    step.value = 'parsing'
    error.value = ''

    try {
      // Parse the URI
      parsedRequest = parseAuthorizationRequest(uri)
      const request = parsedRequest.request

      // Handle JAR (request_uri) if needed
      if (needsJarFetch(parsedRequest) && request.request_uri) {
        step.value = 'parsing'
        const jarResponse = await fetch(request.request_uri)
        if (!jarResponse.ok) {
          throw new Error(`Failed to fetch request object: ${jarResponse.status}`)
        }
        // For now, treat the response as a plain JSON request object
        // (full JWT JAR decoding is a future enhancement)
        const jarBody = await jarResponse.json()
        parsedRequest = parseAuthorizationRequest(jarBody)
      }

      // Load wallet credentials
      const api = (window as any).presenciaAPI
      if (!api?.vault?.read) throw new Error('Vault IPC not available')
      const contents = await api.vault.read()
      walletCredentials = contents?.credentials ?? []

      // Get what the verifier wants
      const requested = request.dcql_query
        ? getRequestedCredentials(request.dcql_query)
        : []

      // Match against wallet
      if (request.dcql_query) {
        matchResult = matchCredentials(
          request.dcql_query,
          walletCredentials as unknown as VerifiableCredential[]
        )
      } else {
        // No DCQL query — present all credentials
        matchResult = {
          satisfied: walletCredentials.length > 0,
          matches: new Map([['all', walletCredentials as unknown as VerifiableCredential[]]]),
          missing: [],
        }
      }

      // Find matched credentials for display
      const matched: VaultCredential[] = []
      if (matchResult.matches) {
        for (const creds of matchResult.matches.values()) {
          for (const c of creds) {
            if (!matched.find(m => m.id === (c as any).id)) {
              matched.push(c as unknown as VaultCredential)
            }
          }
        }
      }

      const info: ConsentInfo = {
        clientId: request.client_id || 'Unknown verifier',
        requestedTypes: requested,
        matchResult,
        matchedCredentials: matched,
      }

      consent.value = info
      step.value = 'consent'
      return info
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      step.value = 'error'
      return null
    }
  }

  /**
   * Step 2: User approved — build signed VP and submit.
   * @param selectedCredentials Credentials the user chose to present (subset of matchedCredentials)
   */
  async function approve(selectedCredentials?: VaultCredential[]): Promise<boolean> {
    if (!parsedRequest || !consent.value) {
      error.value = 'No pending request'
      step.value = 'error'
      return false
    }

    step.value = 'signing'
    error.value = ''

    try {
      const api = (window as any).presenciaAPI
      if (!api?.vault?.sign || !api?.vault?.read) throw new Error('Vault IPC not available')

      const contents = await api.vault.read()
      const holderDid: string = contents?.identity?.did
      if (!holderDid) throw new Error('No identity in vault')

      const request = parsedRequest.request
      const creds = selectedCredentials || consent.value.matchedCredentials
      const nonce = request.nonce || globalThis.crypto.randomUUID()
      const created = new Date().toISOString()

      // Build VP envelope
      const vpBody = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holderDid,
        verifiableCredential: creds,
      }

      // Build proof input and sign via IPC
      const vpHash = await hashObject(vpBody)
      const proofInput = {
        '@context': vpBody['@context'],
        type: 'Ed25519Signature2020',
        created,
        verificationMethod: `${holderDid}#key-1`,
        proofPurpose: 'authentication',
        nonce,
        domain: request.client_id,
        vpHash,
      }

      const proofBytes = new TextEncoder().encode(canonicalize(proofInput))
      const signatureBytes: Uint8Array = await api.vault.sign(proofBytes)
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
          domain: request.client_id,
        },
      } as VerifiablePresentation

      resultVp.value = vp

      // Submit if direct_post
      if (isDirectPost(request) && request.response_uri) {
        step.value = 'submitting'

        const matchedIds = matchResult?.matches
          ? Array.from(matchResult.matches.keys())
          : undefined

        const body = buildDirectPostBody(vp, request, matchedIds)
        const encoded = encodeDirectPostBody(body)

        const response = await fetch(request.response_uri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: encoded,
        })

        if (!response.ok) {
          throw new Error(`Verifier rejected: ${response.status} ${response.statusText}`)
        }
      }

      step.value = 'done'
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      step.value = 'error'
      return false
    }
  }

  return { step, error, consent, resultVp, reset, parseRequest, approve }
}

// Helpers (same as usePresentation.ts)

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
