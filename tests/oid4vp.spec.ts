import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseAuthorizationRequest,
  getRequestedCredentials,
  matchCredentials,
  isDirectPost,
  buildDirectPostBody,
  encodeDirectPostBody,
} from '@attestto/vc-sdk'
import type { AuthorizationRequest, DcqlQuery, VerifiableCredential } from '@attestto/vc-sdk'

describe('OID4VP authorization request parsing', () => {
  it('parses an inline request with client_id and nonce', () => {
    const input = {
      client_id: 'https://verifier.example.com',
      response_type: 'vp_token',
      response_mode: 'direct_post',
      response_uri: 'https://verifier.example.com/callback',
      nonce: 'abc123',
    }

    const parsed = parseAuthorizationRequest(input)
    expect(parsed.request.client_id).toBe('https://verifier.example.com')
    expect(parsed.request.nonce).toBe('abc123')
    expect(parsed.source).toBe('inline')
  })

  it('detects direct_post response mode', () => {
    const request: AuthorizationRequest = {
      client_id: 'https://v.example.com',
      response_type: 'vp_token',
      response_mode: 'direct_post',
      response_uri: 'https://v.example.com/cb',
      nonce: 'n1',
    }
    expect(isDirectPost(request)).toBe(true)
  })

  it('isDirectPost returns false for fragment mode', () => {
    const request: AuthorizationRequest = {
      client_id: 'https://v.example.com',
      response_type: 'vp_token',
      response_mode: 'fragment',
      nonce: 'n1',
    }
    expect(isDirectPost(request)).toBe(false)
  })
})

describe('DCQL credential matching', () => {
  const cedula: VerifiableCredential = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'CedulaIdentidadCR'],
    issuer: 'did:key:z6MkTest',
    issuanceDate: '2026-04-17T00:00:00Z',
    credentialSubject: { id: 'did:key:z6MkHolder', cedula: '123456789' },
  }

  const license: VerifiableCredential = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'DrivingLicenseCR'],
    issuer: 'did:key:z6MkTest',
    issuanceDate: '2026-04-17T00:00:00Z',
    credentialSubject: { id: 'did:key:z6MkHolder', categories: ['B1'] },
  }

  it('matches when wallet has the requested type', () => {
    const query: DcqlQuery = {
      credentials: [
        { id: 'cedula', format: 'ldp_vc', claims: [], meta: { vct_values: ['CedulaIdentidadCR'] } },
      ],
    }

    const result = matchCredentials(query, [cedula, license])
    expect(result.satisfied).toBe(true)
    expect(result.matches.size).toBeGreaterThanOrEqual(1)
  })

  it('reports missing when wallet lacks the type', () => {
    const query: DcqlQuery = {
      credentials: [
        { id: 'passport', format: 'ldp_vc', claims: [], meta: { vct_values: ['PassportCR'] } },
      ],
    }

    const result = matchCredentials(query, [cedula])
    expect(result.satisfied).toBe(false)
    expect(result.missing).toContain('passport')
  })

  it('matches multiple credential types', () => {
    const query: DcqlQuery = {
      credentials: [
        { id: 'cedula', format: 'ldp_vc', claims: [], meta: { vct_values: ['CedulaIdentidadCR'] } },
        { id: 'license', format: 'ldp_vc', claims: [], meta: { vct_values: ['DrivingLicenseCR'] } },
      ],
    }

    const result = matchCredentials(query, [cedula, license])
    expect(result.satisfied).toBe(true)
    expect(result.missing).toHaveLength(0)
  })
})

describe('direct_post body building', () => {
  it('builds a body with vp_token', () => {
    const vp = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      holder: 'did:key:z6MkHolder',
      verifiableCredential: [],
      proof: {
        type: 'Ed25519Signature2020',
        created: '2026-04-17T00:00:00Z',
        verificationMethod: 'did:key:z6MkHolder#key-1',
        proofPurpose: 'authentication',
        proofValue: 'test-sig',
      },
    }

    const request: AuthorizationRequest = {
      client_id: 'https://v.example.com',
      response_type: 'vp_token',
      response_mode: 'direct_post',
      response_uri: 'https://v.example.com/cb',
      nonce: 'n1',
      state: 'state123',
    }

    const body = buildDirectPostBody(vp, request)
    expect(body.vp_token).toBeDefined()
    expect(body.state).toBe('state123')
  })

  it('encodes body as URL-encoded string', () => {
    const body = { vp_token: '{"test":true}', state: 's1' }
    const encoded = encodeDirectPostBody(body)
    expect(encoded).toContain('vp_token=')
    expect(encoded).toContain('state=s1')
  })
})

describe('getRequestedCredentials', () => {
  it('extracts credential queries from DCQL', () => {
    const query: DcqlQuery = {
      credentials: [
        { id: 'cedula', format: 'ldp_vc', claims: [], meta: { vct_values: ['CedulaIdentidadCR'] } },
        { id: 'sig', format: 'jwt_vc', claims: [] },
      ],
    }

    const requested = getRequestedCredentials(query)
    expect(requested).toHaveLength(2)
    expect(requested[0].id).toBe('cedula')
    expect(requested[0].format).toBe('ldp_vc')
    expect(requested[1].id).toBe('sig')
  })
})
