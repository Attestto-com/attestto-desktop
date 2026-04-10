/**
 * Firma Digital validator — trust chain validation against bundled BCCR roots.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import forge from 'node-forge'
import { loadTrustAnchors, validatePkcs7, rootsLoaded, __resetForTests } from '../src/main/pki/firma-validator'

const FIXTURE_PATH = join(__dirname, 'fixtures', 'firma-digital-real.pdf')
const TRUST_STORE_DIR = join(__dirname, '..', 'src', 'main', 'pki', 'trust-store')

function trustStoreCertCount(): number {
  if (!existsSync(TRUST_STORE_DIR)) return 0
  let count = 0
  for (const sub of readdirSync(TRUST_STORE_DIR)) {
    const p = join(TRUST_STORE_DIR, sub)
    try {
      if (!statSync(p).isDirectory()) continue
      count += readdirSync(p).filter((f) => /\.(cer|crt|pem|der)$/i.test(f)).length
    } catch { /* skip */ }
  }
  return count
}

function extractFirstPkcs7Hex(bytes: Buffer): string | null {
  const text = bytes.toString('latin1')
  const sigPattern = /\/Type\s*\/Sig\b/
  const m = sigPattern.exec(text)
  if (!m) return null
  const dictStart = text.lastIndexOf('<<', m.index)
  const dictEnd = text.indexOf('>>', m.index)
  if (dictStart < 0 || dictEnd < 0) return null
  const dict = text.substring(dictStart, dictEnd + 2)
  const cm = dict.match(/\/Contents\s*<([0-9a-fA-F\s]+)>/)
  return cm ? cm[1].replace(/\s/g, '') : null
}

/** Generate a self-signed cert for testing. */
function makeSelfSignedCert(cn: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1)
  const attrs = [{ name: 'commonName', value: cn }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { cert, keys }
}

/** Build a minimal PKCS#7 SignedData containing given certs. */
function buildPkcs7Hex(certs: forge.pki.Certificate[]): string {
  const p7 = forge.pkcs7.createSignedData()
  for (const c of certs) p7.addCertificate(c)
  const asn1 = p7.toAsn1()
  const der = forge.asn1.toDer(asn1)
  return forge.util.bytesToHex(der.getBytes())
}

describe('Firma Digital validator', () => {
  // ── Trust anchor loading ──

  describe('loadTrustAnchors', () => {
    beforeEach(() => __resetForTests())

    it('loads trust anchors from trust-store/', () => {
      const result = loadTrustAnchors()
      expect(result.count).toBeGreaterThan(0)
      expect(result.byOrigin).toHaveProperty('bccr')
      expect(rootsLoaded()).toBe(true)
    })

    it('reports count by origin', () => {
      const result = loadTrustAnchors()
      const bccr = result.byOrigin['bccr'] ?? 0
      expect(bccr).toBeGreaterThan(0)
    })

    it('rootsLoaded returns false before loading', () => {
      expect(rootsLoaded()).toBe(false)
    })
  })

  // ── No anchors ──

  describe('no trust anchors', () => {
    beforeEach(() => __resetForTests())

    it('returns no-roots-bundled on any input', async () => {
      const result = await validatePkcs7('00')
      expect(result.trusted).toBe(false)
      expect(result.chain.status).toBe('no-roots-bundled')
      expect(result.summary).toContain('anclas de confianza')
    })
  })

  // ── Parse errors ──

  describe('parse errors', () => {
    beforeEach(() => {
      __resetForTests()
      loadTrustAnchors()
    })

    it('returns parse-error on non-hex garbage', async () => {
      const result = await validatePkcs7('not-hex-at-all')
      expect(result.trusted).toBe(false)
      expect(result.chain.status).toBe('parse-error')
      expect(result.summary).toBe('No se pudo leer la firma PKCS#7')
      expect(result.diagnostics.length).toBeGreaterThan(0)
    })

    it('returns parse-error on valid hex but invalid ASN.1', async () => {
      const result = await validatePkcs7('deadbeef')
      expect(result.trusted).toBe(false)
      expect(result.chain.status).toBe('parse-error')
    })

    it('returns parse-error on empty string after whitespace strip', async () => {
      const result = await validatePkcs7('   ')
      expect(result.trusted).toBe(false)
      expect(result.chain.status).toBe('parse-error')
    })
  })

  // ── Empty PKCS#7 (no certs) ──

  describe('PKCS#7 with no certificates', () => {
    beforeEach(() => {
      __resetForTests()
      loadTrustAnchors()
    })

    it('returns incomplete when PKCS#7 contains zero certs', async () => {
      const hex = buildPkcs7Hex([])
      const result = await validatePkcs7(hex)
      expect(result.trusted).toBe(false)
      expect(result.chain.status).toBe('incomplete')
      expect(result.summary).toContain('sin certificados')
    })
  })

  // ── Self-signed cert (not in trust store) ──

  describe('untrusted self-signed cert', () => {
    beforeEach(() => {
      __resetForTests()
      loadTrustAnchors()
    })

    it('returns untrusted-root for a cert not in the trust store', async () => {
      const { cert } = makeSelfSignedCert('Evil Corp Test CA')
      const hex = buildPkcs7Hex([cert])
      const result = await validatePkcs7(hex)
      expect(result.trusted).toBe(false)
      expect(['untrusted-root', 'expired']).toContain(result.chain.status)
    })
  })

  // ── Valid chain (BCCR root) ──

  describe('valid BCCR chain (real fixture)', () => {
    beforeEach(() => {
      __resetForTests()
      loadTrustAnchors()
    })

    it('validates a real CR-signed PDF end-to-end', async () => {
      if (!rootsLoaded()) {
        console.warn('[test] SKIPPED — no BCCR trust anchors')
        return
      }
      if (!existsSync(FIXTURE_PATH)) {
        console.warn(`[test] SKIPPED — no fixture at ${FIXTURE_PATH}`)
        return
      }

      const bytes = readFileSync(FIXTURE_PATH)
      const pkcs7Hex = extractFirstPkcs7Hex(bytes)
      if (!pkcs7Hex) {
        console.warn('[test] SKIPPED — could not extract PKCS#7 from fixture')
        return
      }

      const result = await validatePkcs7(pkcs7Hex)

      expect(result.chain.status).toBe('valid')
      if (result.chain.status === 'valid') {
        expect(result.trusted).toBe(true)
        expect(result.chain.rootSubject).toMatch(/CR|COSTA RICA|BCCR|RAIZ/i)
        expect(result.chain.rootOrigin).toBe('bccr')
        expect(result.summary).toContain('CR Firma Digital')
      }
    })
  })

  // ── Result shape ──

  describe('result shape', () => {
    beforeEach(() => {
      __resetForTests()
      loadTrustAnchors()
    })

    it('always returns trusted, chain, ocsp, summary, diagnostics', async () => {
      const result = await validatePkcs7('deadbeef')
      expect(result).toHaveProperty('trusted')
      expect(result).toHaveProperty('chain')
      expect(result).toHaveProperty('chain.status')
      expect(result).toHaveProperty('ocsp')
      expect(result).toHaveProperty('ocsp.status')
      expect(result).toHaveProperty('summary')
      expect(result).toHaveProperty('diagnostics')
      expect(typeof result.trusted).toBe('boolean')
      expect(Array.isArray(result.diagnostics)).toBe(true)
    })
  })
})
