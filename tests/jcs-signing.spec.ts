import { describe, it, expect, beforeEach, vi } from 'vitest'
import { canonicalize } from 'json-canonicalize'
import nacl from 'tweetnacl'

// Mock stationKeys — the real one requires Electron safeStorage
const mockMasterKeyPair = nacl.sign.keyPair()
vi.mock('../src/main/station/station-keys', () => ({
  stationKeys: {
    getSecretKey: () => mockMasterKeyPair.secretKey.slice(0, 32), // 32-byte seed
    getPublicKey: () => mockMasterKeyPair.publicKey,
  },
}))

import {
  prepareCredential,
  finalizeCredential,
  signWithPairwiseKey,
  buildDelegationBinding,
  verifyPairwiseProof,
} from '../src/main/station/station-pairwise'

// --- JCS (RFC 8785) canonicalization tests ---

describe('JCS canonicalization (RFC 8785)', () => {
  it('sorts object keys lexicographically', () => {
    const input = { z: 1, a: 2, m: 3 }
    expect(canonicalize(input)).toBe('{"a":2,"m":3,"z":1}')
  })

  it('sorts nested object keys', () => {
    const input = { b: { z: 1, a: 2 }, a: 3 }
    expect(canonicalize(input)).toBe('{"a":3,"b":{"a":2,"z":1}}')
  })

  it('preserves array order', () => {
    const input = { arr: [3, 1, 2] }
    expect(canonicalize(input)).toBe('{"arr":[3,1,2]}')
  })

  it('canonicalizes numbers (no trailing zeros)', () => {
    expect(canonicalize({ n: 1.0 })).toBe('{"n":1}')
    expect(canonicalize({ n: 0 })).toBe('{"n":0}')
  })

  it('handles null values', () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}')
  })

  it('handles empty objects and arrays', () => {
    expect(canonicalize({})).toBe('{}')
    expect(canonicalize({ a: [] })).toBe('{"a":[]}')
    expect(canonicalize({ a: {} })).toBe('{"a":{}}')
  })

  it('produces identical output regardless of input key order', () => {
    const a = { issuer: 'did:key:z6Mk', type: ['VC'], '@context': ['https://w3.org'] }
    const b = { '@context': ['https://w3.org'], type: ['VC'], issuer: 'did:key:z6Mk' }
    expect(canonicalize(a)).toBe(canonicalize(b))
  })

  it('handles Unicode strings', () => {
    const input = { name: 'José María' }
    const result = canonicalize(input)
    expect(result).toContain('José María')
  })
})

// --- 2-step signing flow tests ---

describe('2-step credential signing flow', () => {
  const credentialId = 'urn:attestto:test:credential:1'

  it('prepareCredential returns sub-public-key and delegation', () => {
    const prepared = prepareCredential(credentialId)
    expect(prepared.subPublicKey).toBeInstanceOf(Uint8Array)
    expect(prepared.subPublicKey.length).toBe(32)
    expect(prepared.delegationProof).toBeInstanceOf(Uint8Array)
    expect(prepared.delegationBinding).toBeInstanceOf(Uint8Array)
    expect(prepared.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('finalizeCredential signs the message and returns proof', () => {
    const prepared = prepareCredential(credentialId)
    const body = { issuer: 'did:key:z6MkTest', type: ['VC'] }
    const canonical = canonicalize(body)
    const messageBytes = new TextEncoder().encode(canonical)

    const proofValue = finalizeCredential(credentialId, messageBytes)
    expect(proofValue).toBeInstanceOf(Uint8Array)
    expect(proofValue.length).toBe(64) // ed25519 signature
  })

  it('signed credential verifies correctly', () => {
    const prepared = prepareCredential(credentialId)
    const body = { issuer: 'did:key:z6MkTest', type: ['VC'] }
    const canonical = canonicalize(body)
    const messageBytes = new TextEncoder().encode(canonical)

    const proofValue = finalizeCredential(credentialId, messageBytes)

    // Verify the sub-key signature
    const valid = nacl.sign.detached.verify(messageBytes, proofValue, prepared.subPublicKey)
    expect(valid).toBe(true)
  })

  it('different key ordering still verifies (JCS normalizes)', () => {
    const prepared = prepareCredential(credentialId)

    // Canonicalize two objects with different key order
    const body1 = { issuer: 'did:key:z6MkTest', type: ['VC'], name: 'Test' }
    const body2 = { name: 'Test', type: ['VC'], issuer: 'did:key:z6MkTest' }
    const canonical1 = canonicalize(body1)
    const canonical2 = canonicalize(body2)
    expect(canonical1).toBe(canonical2)

    const messageBytes = new TextEncoder().encode(canonical1)
    const proofValue = finalizeCredential(credentialId, messageBytes)

    // Verify with bytes from the "other order" — should be identical
    const messageBytes2 = new TextEncoder().encode(canonical2)
    const valid = nacl.sign.detached.verify(messageBytes2, proofValue, prepared.subPublicKey)
    expect(valid).toBe(true)
  })

  it('round-trip: sign → serialize → deserialize → verify', () => {
    const prepared = prepareCredential(credentialId)
    const body = { '@context': ['https://www3.org'], issuer: 'did:key:z6Mk', type: ['VC'] }
    const canonical = canonicalize(body)
    const messageBytes = new TextEncoder().encode(canonical)
    const proofValue = finalizeCredential(credentialId, messageBytes)

    // Serialize to base64 (as stored in a credential proof block)
    const proofValueB64 = Buffer.from(proofValue).toString('base64')
    const subPubB64 = Buffer.from(prepared.subPublicKey).toString('base64')

    // Deserialize (as a verifier would)
    const restoredProof = new Uint8Array(Buffer.from(proofValueB64, 'base64'))
    const restoredPub = new Uint8Array(Buffer.from(subPubB64, 'base64'))

    // Re-canonicalize the body and verify
    const recanonical = canonicalize(body)
    const reMessage = new TextEncoder().encode(recanonical)
    const valid = nacl.sign.detached.verify(reMessage, restoredProof, restoredPub)
    expect(valid).toBe(true)
  })
})

// --- Unhappy path tests ---

describe('2-step flow — unhappy paths', () => {
  const credentialId = 'urn:attestto:test:unhappy'

  it('finalizeCredential throws without prepareCredential', () => {
    const msg = new TextEncoder().encode('test')
    expect(() => finalizeCredential('urn:attestto:nonexistent', msg)).toThrow(
      /No pending sub-key/,
    )
  })

  it('double-finalize throws (sub-secret already wiped)', () => {
    prepareCredential(credentialId)
    const msg = new TextEncoder().encode('test')
    finalizeCredential(credentialId, msg) // first call OK
    expect(() => finalizeCredential(credentialId, msg)).toThrow(/No pending sub-key/)
  })

  it('tampered credential body fails verification', () => {
    const prepared = prepareCredential(credentialId)
    const body = { issuer: 'did:key:z6MkTest', type: ['VC'] }
    const canonical = canonicalize(body)
    const messageBytes = new TextEncoder().encode(canonical)
    const proofValue = finalizeCredential(credentialId, messageBytes)

    // Tamper with the body
    const tampered = { issuer: 'did:key:z6MkEvil', type: ['VC'] }
    const tamperedBytes = new TextEncoder().encode(canonicalize(tampered))
    const valid = nacl.sign.detached.verify(tamperedBytes, proofValue, prepared.subPublicKey)
    expect(valid).toBe(false)
  })

  it('wrong sub-key fails signature check', () => {
    const prepared = prepareCredential(credentialId)
    const body = { issuer: 'did:key:z6MkTest' }
    const canonical = canonicalize(body)
    const messageBytes = new TextEncoder().encode(canonical)
    const proofValue = finalizeCredential(credentialId, messageBytes)

    // Try to verify with a random key
    const wrongKey = nacl.sign.keyPair().publicKey
    const valid = nacl.sign.detached.verify(messageBytes, proofValue, wrongKey)
    expect(valid).toBe(false)
  })

  it('prepareCredential overwrites previous pending key for same credentialId', () => {
    prepareCredential(credentialId)
    const second = prepareCredential(credentialId)
    // The second prepare should work; first sub-secret wiped
    const msg = new TextEncoder().encode('test')
    const proof = finalizeCredential(credentialId, msg)
    const valid = nacl.sign.detached.verify(msg, proof, second.subPublicKey)
    expect(valid).toBe(true)
  })
})

// --- Legacy 1-step flow (still used for PDF signing) ---

describe('legacy signWithPairwiseKey (1-step)', () => {
  it('signs and verifies correctly', () => {
    const body = { type: 'test' }
    const messageBytes = new TextEncoder().encode(canonicalize(body))
    const proof = signWithPairwiseKey('test-cred', messageBytes)

    const valid = nacl.sign.detached.verify(messageBytes, proof.proofValue, proof.subPublicKey)
    expect(valid).toBe(true)
  })
})

// --- Delegation chain verification ---

describe('delegation chain verification', () => {
  it('verifyPairwiseProof validates both signatures', () => {
    const body = { type: 'test' }
    const messageBytes = new TextEncoder().encode(canonicalize(body))
    const proof = signWithPairwiseKey('test-cred', messageBytes)

    const result = verifyPairwiseProof(proof, messageBytes, 'test-cred', mockMasterKeyPair.publicKey)
    expect(result.subSignatureValid).toBe(true)
    expect(result.delegationValid).toBe(true)
  })

  it('tampered binding fails delegation check', () => {
    const body = { type: 'test' }
    const messageBytes = new TextEncoder().encode(canonicalize(body))
    const proof = signWithPairwiseKey('test-cred', messageBytes)

    // Tamper with delegation binding
    proof.delegationBinding[0] ^= 0xff
    const result = verifyPairwiseProof(proof, messageBytes, 'test-cred', mockMasterKeyPair.publicKey)
    expect(result.delegationValid).toBe(false)
  })
})
