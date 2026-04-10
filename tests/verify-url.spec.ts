/**
 * Credential verify URL generation — ensures the desktop app builds
 * correct URLs that the offer page can consume.
 */

import { describe, it, expect } from 'vitest'

// Replicate the logic from CredentialsPage.vue so we can test it in isolation
function verifyUrl(credential: { id?: string; issuer?: { name?: string; id?: string }; issuanceDate?: string; trustLevel?: string }, title: string): string {
  const vcPayload = btoa(JSON.stringify(credential))
  const preview = btoa(JSON.stringify({
    type: title,
    issuer: credential.issuer?.name || credential.issuer?.id || 'Attestto Platform',
    level: credential.trustLevel ? `Nivel ${credential.trustLevel}` : undefined,
    issuedAt: credential.issuanceDate || undefined,
  }))
  return `https://verify.attestto.com/offer/#vc=${vcPayload}&v=1&preview=${preview}`
}

describe('verifyUrl', () => {
  it('generates URL pointing to /offer/ not /c/', () => {
    const url = verifyUrl({ id: 'test-123' }, 'Cédula de Identidad')
    expect(url).toContain('verify.attestto.com/offer/')
    expect(url).not.toContain('/c/')
  })

  it('includes vc= and preview= in fragment', () => {
    const url = verifyUrl({
      id: 'urn:uuid:abc',
      issuer: { name: 'Attestto Platform', id: 'did:sns:attestto.sol' },
      issuanceDate: '2026-04-08T00:00:00Z',
      trustLevel: 'B',
    }, 'Cédula de Identidad')

    const fragment = url.split('#')[1]
    expect(fragment).toBeDefined()
    expect(fragment).toContain('vc=')
    expect(fragment).toContain('preview=')
    expect(fragment).toContain('v=1')
  })

  it('encodes the full credential in vc= as base64', () => {
    const cred = { id: 'test-id', issuer: { name: 'Test' } }
    const url = verifyUrl(cred, 'Test Credential')
    const fragment = url.split('#')[1]
    const vcParam = fragment.split('&').find(p => p.startsWith('vc='))!.slice(3)
    const decoded = JSON.parse(atob(vcParam))
    expect(decoded.id).toBe('test-id')
    expect(decoded.issuer.name).toBe('Test')
  })

  it('preview contains type, issuer, and level', () => {
    const url = verifyUrl({
      issuer: { name: 'COSEVI' },
      trustLevel: 'A',
    }, 'Licencia de Conducir')

    const fragment = url.split('#')[1]
    const previewParam = fragment.split('&').find(p => p.startsWith('preview='))!.slice(8)
    const preview = JSON.parse(atob(previewParam))
    expect(preview.type).toBe('Licencia de Conducir')
    expect(preview.issuer).toBe('COSEVI')
    expect(preview.level).toBe('Nivel A')
  })

  it('falls back to Attestto Platform when issuer has no name', () => {
    const url = verifyUrl({ id: 'x' }, 'Test')
    const fragment = url.split('#')[1]
    const previewParam = fragment.split('&').find(p => p.startsWith('preview='))!.slice(8)
    const preview = JSON.parse(atob(previewParam))
    expect(preview.issuer).toBe('Attestto Platform')
  })

  it('never generates a URL with path-based ID (old broken pattern)', () => {
    const url = verifyUrl({ id: 'urn:uuid:some-credential' }, 'Test')
    // The old broken pattern was: /c/urn%3Auuid%3Asome-credential
    expect(url).not.toMatch(/\/c\/[^#]/)
    expect(url).not.toContain(encodeURIComponent('urn:uuid:some-credential'))
  })
})
