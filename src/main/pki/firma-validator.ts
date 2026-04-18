/**
 * Firma Digital validator — main process.
 *
 * Loads the bundled trust store at startup, validates PKCS#7 (CMS SignedData)
 * blobs extracted from signed PDFs against it using node-forge, and (when
 * online and a responder URL is found in the cert AIA extension) checks
 * revocation via OCSP.
 *
 * The trust store is multi-anchor by design — see
 * `attestto-desktop/docs/ca-trust-framework.md` for the architecture. Each
 * subdirectory under `pki/trust-store/` holds the cert(s) for one trust
 * authority and contributes its origin tag to the validation result, so the
 * UI can differentiate "CR Firma Digital" anchors from "Attestto" anchors
 * without losing the trust binding.
 *
 * Designed to run inside Electron main, where filesystem + node:https are
 * available. The renderer reaches it via IPC (`firma:validate-pkcs7`).
 *
 * SCAFFOLD STATUS (Session 1):
 *   - Trust anchor loader: WORKING (drops `.cer`/`.pem`/`.crt`/`.der` files
 *     into any subdirectory of `pki/trust-store/` and they will be picked up
 *     at startup, tagged with the subdirectory name as `origin`).
 *   - Chain validation: WORKING via forge.pki.verifyCertificateChain.
 *   - OCSP fetch: STUB — returns `not-checked` until a follow-up commit wires
 *     the actual OCSP request/response codec.
 *
 * The output shape (`FirmaValidationResult`) is final.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import forge from 'node-forge'
import { ALL_CERTS as CR_TRUST_CERTS } from '@attestto/trust/cr'
import type { FirmaValidationResult, TrustAnchorOrigin } from '../../shared/firma-api'

// ── Trust anchor loading ────────────────────────────────────────────

interface TaggedAnchor {
  cert: forge.pki.Certificate
  origin: TrustAnchorOrigin
  /** Stable identity string for matching the chain root back to its origin. */
  subjectHash: string
}

/** All loaded trust anchors. */
const anchors: TaggedAnchor[] = []
/** forge CA store built from `anchors`, used by verifyCertificateChain. */
let caStore: forge.pki.CAStore | null = null

/**
 * Resolve the directory holding the bundled trust store. In production
 * electron-builder copies it into the app resources dir; in dev we walk back
 * to the source tree.
 */
function resolveTrustStoreDir(): string {
  const prodPath = process.resourcesPath
    ? join(process.resourcesPath, 'trust-store')
    : null
  const candidates = [
    ...(prodPath ? [prodPath] : []),
    join(__dirname, 'pki', 'trust-store'),
    join(__dirname, '..', '..', 'src', 'main', 'pki', 'trust-store'),
    join(process.cwd(), 'src', 'main', 'pki', 'trust-store'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

/** Parse a single cert file (DER or PEM) into a forge Certificate. Returns null on failure. */
function parseCertFile(path: string): forge.pki.Certificate | null {
  try {
    const raw = readFileSync(path)
    const text = raw.toString('utf-8')
    if (text.includes('-----BEGIN CERTIFICATE-----')) {
      return forge.pki.certificateFromPem(text)
    }
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(raw.toString('binary')))
    return forge.pki.certificateFromAsn1(asn1)
  } catch (err) {
    console.warn(`[firma] failed to parse cert ${path}:`, (err as Error).message)
    return null
  }
}

/**
 * Load trust anchors from @attestto/trust (primary) and the local filesystem
 * (overlay for custom origins like 'attestto'). Idempotent.
 *
 * BCCR certs come from the centralized @attestto/trust package — they are
 * bundled at build time and need no filesystem access. The local trust-store
 * directory adds non-BCCR origins (e.g. future Attestto CA certs).
 */
export function loadTrustAnchors(): { count: number; dir: string; byOrigin: Record<string, number> } {
  anchors.length = 0
  const byOrigin: Record<string, number> = {}

  // 1. Load BCCR certs from @attestto/trust package (build-time bundled)
  for (const entry of CR_TRUST_CERTS) {
    try {
      const cert = forge.pki.certificateFromPem(entry.pem)
      anchors.push({
        cert,
        origin: 'bccr',
        subjectHash: cert.subject.hash,
      })
      byOrigin['bccr'] = (byOrigin['bccr'] ?? 0) + 1
    } catch (err) {
      console.warn(`[firma] failed to parse @attestto/trust cert ${entry.name}:`, (err as Error).message)
    }
  }

  // 2. Load additional certs from local filesystem (non-bccr origins only)
  const root = resolveTrustStoreDir()
  if (existsSync(root)) {
    const subdirs = readdirSync(root).filter((name) => {
      if (name === 'bccr') return false // already loaded from package
      try {
        return statSync(join(root, name)).isDirectory()
      } catch {
        return false
      }
    })

    for (const origin of subdirs) {
      const subdir = join(root, origin)
      const files = readdirSync(subdir).filter((f) => /\.(cer|crt|pem|der)$/i.test(f))
      for (const f of files) {
        const cert = parseCertFile(join(subdir, f))
        if (cert) {
          anchors.push({
            cert,
            origin,
            subjectHash: cert.subject.hash,
          })
          byOrigin[origin] = (byOrigin[origin] ?? 0) + 1
        }
      }
    }
  }

  caStore = forge.pki.createCaStore(anchors.map((a) => a.cert))

  if (anchors.length === 0) {
    console.warn(`[firma] no trust anchors loaded — validator will mark all signatures as no-roots-bundled`)
  } else {
    const summary = Object.entries(byOrigin)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')
    console.log(`[firma] loaded ${anchors.length} trust anchor(s) (${summary})`)
  }

  return { count: anchors.length, dir: root, byOrigin }
}

export function rootsLoaded(): boolean {
  return anchors.length > 0
}

/** Look up the origin tag for a chain root by its subject hash. */
function findOrigin(root: forge.pki.Certificate): TrustAnchorOrigin {
  const match = anchors.find((a) => a.subjectHash === root.subject.hash)
  return match?.origin ?? 'unknown'
}

// ── Resolver fallback (ATT-441) ─────────────────────────────────────

const RESOLVER_URL = 'https://resolver.attestto.com/1.0/identifiers'
const RESOLVER_TIMEOUT_MS = 10_000

/** Simple cache for resolved DID Documents (5 min TTL). */
const resolverCache = new Map<string, { certs: forge.pki.Certificate[]; origin: string; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000

/**
 * Extract country code from a cert's subject or issuer fields.
 * Returns lowercase ISO 3166-1 alpha-2 (e.g. 'cr', 'br', 'ar').
 */
function extractCountry(cert: forge.pki.Certificate): string | null {
  const c =
    cert.subject.getField('C')?.value ??
    cert.issuer.getField('C')?.value
  return c ? String(c).toLowerCase() : null
}

/**
 * Derive a simple did:pki path from a CA cert's common name and country.
 * This is a lightweight version of attestto-verify's pki-did-derivation.ts.
 */
function derivePkiDid(cert: forge.pki.Certificate, country: string): string | null {
  const cn = (cert.subject.getField('CN')?.value ?? '').toUpperCase()
  if (!cn) return null

  // Country-specific patterns (must match attestto-verify's CA_DID_MAPPINGS)
  const patterns: Record<string, Array<{ match: string; path: string }>> = {
    cr: [
      { match: 'SINPE', path: 'sinpe' },
      { match: 'POLITICA', path: 'politica' },
      { match: 'RAIZ NACIONAL', path: 'raiz-nacional' },
    ],
    br: [
      { match: 'SERPRO', path: 'serpro' },
      { match: 'CERTISIGN', path: 'certisign' },
      { match: 'RAIZ BRASILEIRA', path: 'raiz-brasileira' },
      { match: 'ICP-BRASIL', path: 'icp-brasil' },
    ],
    ar: [
      { match: 'FIRMA DIGITAL', path: 'acfd' },
      { match: 'AC RAIZ', path: 'raiz' },
    ],
  }

  const countryPatterns = patterns[country]
  if (countryPatterns) {
    for (const p of countryPatterns) {
      if (cn.includes(p.match)) return `did:pki:${country}:${p.path}`
    }
  }

  // Heuristic: normalize CA name into a path segment
  const normalized = cn
    .replace(/^(CA|AC|AUTORIDADE CERTIFICADORA|AUTORIDAD CERTIFICANTE)\s+/i, '')
    .replace(/\s*V\d+\s*$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized ? `did:pki:${country}:${normalized}` : null
}

/**
 * Try to resolve trust anchors via resolver.attestto.com for a non-CR cert chain.
 * Returns forge.pki.Certificate[] from the resolved DID Document, or empty array on failure.
 */
async function resolveRemoteAnchors(
  chain: forge.pki.Certificate[],
  diagnostics: string[],
): Promise<{ certs: forge.pki.Certificate[]; origin: string } | null> {
  // Walk chain from root downward to find a resolvable CA
  for (let i = chain.length - 1; i >= 0; i--) {
    const cert = chain[i]
    const country = extractCountry(cert)
    if (!country) continue

    const did = derivePkiDid(cert, country)
    if (!did) continue

    // Check cache
    const cached = resolverCache.get(did)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      diagnostics.push(`resolver cache hit: ${did}`)
      return { certs: cached.certs, origin: cached.origin }
    }

    diagnostics.push(`resolver: trying ${did}`)

    try {
      const response = await fetch(`${RESOLVER_URL}/${encodeURIComponent(did)}`, {
        signal: AbortSignal.timeout(RESOLVER_TIMEOUT_MS),
        headers: { Accept: 'application/did+json, application/json' },
      })

      if (!response.ok) {
        diagnostics.push(`resolver: ${did} → ${response.status}`)
        continue
      }

      const body = await response.json()
      const didDoc = body.didDocument
      if (!didDoc?.verificationMethod) continue

      // Extract PEM-encoded certificates from the DID Document
      const resolved: forge.pki.Certificate[] = []
      for (const vm of didDoc.verificationMethod) {
        // The resolver may include x5c (cert chain) in the JWK
        if (vm.publicKeyJwk?.x5c) {
          for (const b64Cert of vm.publicKeyJwk.x5c) {
            try {
              const pem = `-----BEGIN CERTIFICATE-----\n${b64Cert}\n-----END CERTIFICATE-----`
              resolved.push(forge.pki.certificateFromPem(pem))
            } catch { /* skip unparseable */ }
          }
        }
      }

      if (resolved.length === 0) {
        diagnostics.push(`resolver: ${did} resolved but no x5c certs`)
        continue
      }

      const origin = didDoc.pkiMetadata?.countryName?.toLowerCase() ?? country
      resolverCache.set(did, { certs: resolved, origin, ts: Date.now() })
      diagnostics.push(`resolver: ${did} → ${resolved.length} cert(s) from ${origin}`)
      return { certs: resolved, origin }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      diagnostics.push(`resolver: ${did} failed — ${msg}`)
    }
  }

  return null
}

// ── Validation ──────────────────────────────────────────────────────

function hexToBinary(hex: string): string {
  const clean = hex.replace(/\s/g, '')
  return forge.util.hexToBytes(clean)
}

function extractCertsFromPkcs7(pkcs7Hex: string): forge.pki.Certificate[] {
  const binary = hexToBinary(pkcs7Hex)
  // strict=false: PKCS#7 /Contents blobs are often padded with trailing
  // zero bytes inside the PDF, which forge would otherwise reject with
  // "Unparsed DER bytes remain". (@types/node-forge 1.3.x only exposes
  // the boolean form; the {strict, parseAllBytes} object form was an
  // incorrect call signature.)
  const asn1 = forge.asn1.fromDer(binary, false)
  const msg = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
    certificates?: forge.pki.Certificate[]
  }
  return msg.certificates ?? []
}

/**
 * Get SubjectKeyIdentifier hex (lowercase) for a cert, or null.
 * forge stores extensions with snake_case OID names.
 */
function getSki(cert: forge.pki.Certificate): string | null {
  const ext = cert.getExtension('subjectKeyIdentifier') as
    | { subjectKeyIdentifier?: string }
    | undefined
  return ext?.subjectKeyIdentifier?.toLowerCase() ?? null
}

/** Get AuthorityKeyIdentifier (keyIdentifier field) hex (lowercase), or null. */
function getAki(cert: forge.pki.Certificate): string | null {
  const ext = cert.getExtension('authorityKeyIdentifier') as
    | { authorityKeyIdentifier?: string; keyIdentifier?: string }
    | undefined
  const aki = ext?.authorityKeyIdentifier ?? ext?.keyIdentifier
  if (!aki) return null
  // forge sometimes returns the full DER-wrapped value; strip non-hex chars
  // and take the trailing 20-byte (40-hex) keyIdentifier when present.
  const hex = aki.toLowerCase().replace(/[^0-9a-f]/g, '')
  return hex.length >= 40 ? hex.slice(-40) : hex
}

/**
 * Fallback issuer match: AKI(child) === SKI(candidate). Used when forge's
 * DN-based `isIssuer` rejects a valid pair due to attribute encoding /
 * ordering differences (TSE Sello Electrónico PDFs hit this).
 */
function akiSkiIssuer(child: forge.pki.Certificate, candidate: forge.pki.Certificate): boolean {
  const aki = getAki(child)
  const ski = getSki(candidate)
  return !!aki && !!ski && aki === ski
}

function buildChain(
  endEntity: forge.pki.Certificate,
  pool: forge.pki.Certificate[],
): forge.pki.Certificate[] {
  const chain: forge.pki.Certificate[] = [endEntity]
  let current = endEntity

  for (let i = 0; i < 10; i++) {
    if (current.isIssuer(current)) return chain

    const parent =
      pool.find((c) => c !== current && current.isIssuer(c)) ??
      anchors.find((a) => current.isIssuer(a.cert))?.cert ??
      pool.find((c) => c !== current && akiSkiIssuer(current, c)) ??
      anchors.find((a) => akiSkiIssuer(current, a.cert))?.cert

    if (!parent) {
      throw new Error(`incomplete chain: no issuer for ${current.subject.getField('CN')?.value ?? '<unknown>'}`)
    }

    chain.push(parent)
    if (parent.isIssuer(parent)) return chain
    current = parent
  }

  throw new Error('chain too long (> 10 certs) — likely a loop')
}

function pickEndEntity(certs: forge.pki.Certificate[]): forge.pki.Certificate | null {
  if (certs.length === 0) return null
  const issuersSeen = new Set<string>()
  for (const c of certs) {
    issuersSeen.add(c.issuer.hash)
  }
  const candidates = certs.filter((c) => !issuersSeen.has(c.subject.hash))
  return candidates[0] ?? certs[0]
}

/**
 * Validate a PKCS#7 hex blob from a PDF signature dictionary against the
 * bundled trust store.
 */
export async function validatePkcs7(pkcs7Hex: string): Promise<FirmaValidationResult> {
  const diagnostics: string[] = [`checkedAt=${new Date().toISOString()}`]

  if (!caStore || anchors.length === 0) {
    return {
      trusted: false,
      chain: {
        status: 'no-roots-bundled',
        reason: 'No trust anchors are bundled with this build. Drop them in src/main/pki/trust-store/{bccr,attestto}/.',
      },
      ocsp: { status: 'not-checked', reason: 'no trust anchors' },
      summary: 'Sin anclas de confianza — validacion no disponible',
      diagnostics: ['validator started without any trust anchors'],
    }
  }

  let certs: forge.pki.Certificate[]
  try {
    certs = extractCertsFromPkcs7(pkcs7Hex)
  } catch (err) {
    return {
      trusted: false,
      chain: { status: 'parse-error', reason: (err as Error).message },
      ocsp: { status: 'not-checked', reason: 'parse failed' },
      summary: 'No se pudo leer la firma PKCS#7',
      diagnostics: [(err as Error).message],
    }
  }

  diagnostics.push(`extracted ${certs.length} cert(s) from PKCS#7`)

  if (certs.length === 0) {
    return {
      trusted: false,
      chain: { status: 'incomplete', reason: 'PKCS#7 contained no certificates' },
      ocsp: { status: 'not-checked', reason: 'no certs' },
      summary: 'Firma sin certificados embebidos',
      diagnostics,
    }
  }

  const endEntity = pickEndEntity(certs)
  if (!endEntity) {
    return {
      trusted: false,
      chain: { status: 'incomplete', reason: 'could not identify end-entity cert' },
      ocsp: { status: 'not-checked', reason: 'no end-entity' },
      summary: 'No se pudo identificar el certificado del firmante',
      diagnostics,
    }
  }

  let chain: forge.pki.Certificate[]
  try {
    chain = buildChain(endEntity, certs)
  } catch (err) {
    return {
      trusted: false,
      chain: { status: 'incomplete', reason: (err as Error).message },
      ocsp: { status: 'not-checked', reason: 'incomplete chain' },
      summary: 'Cadena de certificados incompleta',
      diagnostics: [...diagnostics, (err as Error).message],
    }
  }

  diagnostics.push(`built chain of length ${chain.length}`)

  let chainVerified = false
  let resolverUsed = false

  try {
    forge.pki.verifyCertificateChain(caStore, chain)
    chainVerified = true
  } catch (err) {
    const e = err as { message?: string; error?: string }
    const reason = e.message || e.error || 'unknown chain verification failure'
    const expired = /not yet valid|has expired/i.test(reason)

    if (expired) {
      return {
        trusted: false,
        chain: { status: 'expired', reason },
        ocsp: { status: 'not-checked', reason: 'chain rejected' },
        summary: 'Certificado expirado o aun no valido',
        diagnostics: [...diagnostics, reason],
      }
    }

    // ATT-441: Try resolver fallback for cross-border signatures
    diagnostics.push(`bundled validation failed: ${reason} — trying resolver`)
    const resolved = await resolveRemoteAnchors(chain, diagnostics)

    if (resolved && resolved.certs.length > 0) {
      try {
        // Build a temporary CA store with resolved + bundled anchors
        const tempStore = forge.pki.createCaStore([
          ...anchors.map((a) => a.cert),
          ...resolved.certs,
        ])
        // Also add resolved certs to the pool for chain building
        const extendedPool = [...certs, ...resolved.certs]
        chain = buildChain(endEntity, extendedPool)
        forge.pki.verifyCertificateChain(tempStore, chain)
        chainVerified = true
        resolverUsed = true
        diagnostics.push(`resolver-backed validation succeeded (${resolved.origin})`)
      } catch (retryErr) {
        const retryReason = (retryErr as Error).message
        diagnostics.push(`resolver-backed validation also failed: ${retryReason}`)
      }
    }

    if (!chainVerified) {
      return {
        trusted: false,
        chain: { status: 'untrusted-root', reason },
        ocsp: { status: 'not-checked', reason: 'chain rejected' },
        summary: 'Cadena no se ancla en una raiz confiable',
        diagnostics: [...diagnostics, reason],
      }
    }
  }

  const root = chain[chain.length - 1]
  const rootSubject = root.subject.getField('CN')?.value ?? '<unknown root>'
  const rootOrigin = resolverUsed ? extractCountry(root) ?? 'resolver' : findOrigin(root)
  diagnostics.push(`chain anchored to: ${rootSubject} (origin=${rootOrigin}${resolverUsed ? ', via resolver' : ''})`)

  // OCSP — STUB. See module header.
  const ocspStatus: FirmaValidationResult['ocsp'] = {
    status: 'not-checked',
    reason: 'OCSP responder fetch not yet implemented (Session 1 stub)',
  }
  diagnostics.push('ocsp: stub — not checked')

  const originLabel =
    rootOrigin === 'bccr'
      ? 'CR Firma Digital'
      : rootOrigin === 'attestto'
        ? 'Attestto'
        : rootOrigin === 'br'
          ? 'BR ICP-Brasil'
          : rootOrigin === 'ar'
            ? 'AR PKI Federal'
            : rootOrigin

  // Chain anchors cleanly and signer cert is within validity. We mark as
  // trusted with an explicit OCSP-pending caveat in the summary. ATT-261 will
  // wire ocsp.sinpe.fi.cr and downgrade to `trusted: false` on revocation.
  return {
    trusted: true,
    chain: { status: 'valid', rootSubject, rootOrigin },
    ocsp: ocspStatus,
    summary: `${originLabel} — cadena valida · OCSP pendiente`,
    diagnostics,
  }
}

// ── Reset (test hook) ───────────────────────────────────────────────

/** Test-only: reset internal state. Not exported through preload. */
export function __resetForTests(): void {
  anchors.length = 0
  caStore = null
}
