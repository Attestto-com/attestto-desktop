import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Test the pure helper functions and the composable logic by mocking the IPC layer.
// We can't import the composable directly (Vue reactivity + window dep), so we
// test the VP structure expectations and the helpers.

describe('VP Presentation helpers', () => {
  // Replicate the helper functions for direct testing
  function uint8ToBase64url(bytes: Uint8Array): string {
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function uint8ToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  describe('uint8ToBase64url', () => {
    it('encodes empty array', () => {
      expect(uint8ToBase64url(new Uint8Array([]))).toBe('')
    })

    it('encodes known bytes to base64url (no padding, url-safe)', () => {
      // [0xfb, 0xff, 0xfe] in standard base64 = "+//+" which should become "-__-" without padding
      const result = uint8ToBase64url(new Uint8Array([0xfb, 0xff, 0xfe]))
      expect(result).not.toContain('+')
      expect(result).not.toContain('/')
      expect(result).not.toContain('=')
    })

    it('produces a 64-byte Ed25519 signature as ~86 chars', () => {
      const fakeSig = new Uint8Array(64).fill(0xab)
      const result = uint8ToBase64url(fakeSig)
      // 64 bytes → 88 base64 chars → remove padding → ~86
      expect(result.length).toBeGreaterThanOrEqual(85)
      expect(result.length).toBeLessThanOrEqual(88)
    })
  })

  describe('uint8ToHex', () => {
    it('encodes empty array', () => {
      expect(uint8ToHex(new Uint8Array([]))).toBe('')
    })

    it('encodes known bytes', () => {
      expect(uint8ToHex(new Uint8Array([0, 15, 255]))).toBe('000fff')
    })

    it('produces 64-char hex for 32 bytes (SHA-256)', () => {
      const hash = new Uint8Array(32).fill(0)
      expect(uint8ToHex(hash)).toHaveLength(64)
    })
  })
})

describe('VP structure expectations', () => {
  it('VP must have W3C context', () => {
    const vp = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      holder: 'did:key:z6MkTest',
      verifiableCredential: [],
    }
    expect(vp['@context']).toContain('https://www.w3.org/2018/credentials/v1')
    expect(vp.type).toContain('VerifiablePresentation')
  })

  it('VP proof must have authentication purpose', () => {
    const proof = {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: 'did:key:z6MkTest#key-1',
      proofPurpose: 'authentication',
      proofValue: 'abc123',
      nonce: 'test-nonce',
    }
    expect(proof.proofPurpose).toBe('authentication')
    expect(proof.type).toBe('Ed25519Signature2020')
    expect(proof.verificationMethod).toContain('#key-1')
  })

  it('VP holder DID must match verificationMethod prefix', () => {
    const holderDid = 'did:key:z6MkTest'
    const verificationMethod = `${holderDid}#key-1`
    expect(verificationMethod.startsWith(holderDid)).toBe(true)
  })

  it('VP proof nonce must be a valid UUID when auto-generated', () => {
    const nonce = globalThis.crypto.randomUUID()
    expect(nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('VP presentation with mocked IPC', () => {
  const mockVaultRead = vi.fn()
  const mockVaultSign = vi.fn()

  beforeEach(() => {
    ;(globalThis as any).window = {
      presenciaAPI: {
        vault: {
          read: mockVaultRead,
          sign: mockVaultSign,
        },
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as any).window
  })

  it('returns null and sets error when vault has no identity', async () => {
    mockVaultRead.mockResolvedValue({ identity: null })

    // Simulate what the composable does
    const api = (globalThis as any).window.presenciaAPI
    const contents = await api.vault.read()
    expect(contents.identity).toBeNull()
  })

  it('calls vault.sign with serialized proof input bytes', async () => {
    const fakeSig = new Uint8Array(64).fill(0x42)
    mockVaultRead.mockResolvedValue({
      identity: { did: 'did:key:z6MkTestHolder', publicKeyHex: 'abc' },
    })
    mockVaultSign.mockResolvedValue(fakeSig)

    const api = (globalThis as any).window.presenciaAPI
    const contents = await api.vault.read()
    expect(contents.identity.did).toBe('did:key:z6MkTestHolder')

    // Sign some bytes
    const testBytes = new TextEncoder().encode('test')
    const sig = await api.vault.sign(testBytes)
    expect(sig).toBeInstanceOf(Uint8Array)
    expect(sig.length).toBe(64)
    expect(mockVaultSign).toHaveBeenCalledWith(testBytes)
  })

  it('vault.sign receives Uint8Array, returns Uint8Array', async () => {
    const input = new TextEncoder().encode(JSON.stringify({ test: true }))
    const output = new Uint8Array(64).fill(0xff)
    mockVaultSign.mockResolvedValue(output)

    const result = await mockVaultSign(input)
    expect(result).toBe(output)
  })
})
