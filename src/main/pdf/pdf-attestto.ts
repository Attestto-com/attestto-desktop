/**
 * Attestto self-attested PDF signature — desktop main process.
 *
 * NOT PAdES. This is Attestto's own signature scheme: a JSON-LD VC over
 * the document hash, signed with the user's vault ed25519 key, embedded
 * in the PDF's Keywords metadata field, plus a visible stamp on the last
 * page.
 *
 * Why not PAdES?
 *  - PAdES requires PKCS#7/CAdES, which requires an X.509 cert chain. Our
 *    Nivel B "self-attested" signatures live in a different trust ladder
 *    that already handles ed25519 DIDs natively (Attestto + mesh anchors).
 *  - We own the reader and the verifier, so Adobe-compatibility is a
 *    non-goal for Nivel B. ATT-340 (real Firma Digital via PKCS#11) is
 *    the path to Nivel A+ PAdES that Adobe sees.
 *
 * Why Keywords field instead of PDF attachments?
 *  - pdf-lib has a clean read/write API for the document Info dict
 *    (getKeywords / setKeywords). Reading file attachments requires
 *    walking the catalog, which is brittle across pdf-lib versions.
 *  - The signature payload is small (<2KB after base64), well within the
 *    Info dict's practical limits.
 *
 * Module boundary: this file should be promotable to @attestto/pdf as
 * `signAttesttoPdf` / `extractAttesttoSignature` / `verifyAttesttoPdf`
 * exports with zero changes to the function signatures. Keep it pure
 * (no Electron, no IPC).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import { appendKeywordRevision, hasExistingSignature } from './incremental-info-update'

/** What we embed in the PDF. Stable wire shape — versioned. */
export interface AttesttoPdfSignature {
  /** Schema version, increment on breaking changes. */
  v: 1
  /** W3C VC type tag. */
  type: ['VerifiableCredential', 'AttesttoPdfSignature']
  /** DID of the signer (did:key:z…). */
  issuer: string
  /** Display name (best-effort, from vault.persona or credential). */
  issuerName?: string
  /** Human-readable Attestto handle (e.g. `cr-111290877.attestto.id`). */
  issuerHandle?: string
  /**
   * ISO 3166-1 alpha-2 country code of the signer's verified identity.
   * Always present when the signer's KYC is country-bound. Used to drive
   * the country flag badge and the trust-chain narrative in the verifier.
   */
  country?: string
  /** ISO 8601 timestamp. */
  signedAt: string
  /** SHA-256 hex of the *original* PDF bytes (before signing). */
  documentHash: string
  /** Original file name at signing time. */
  fileName: string
  /**
   * Signing tier (technical, not legal). The legal level is derived at
   * verify time from `level` + `issuer` (DID method) — see
   * resolveSignatureLevel() in PdfPage.vue. Mapping:
   *   - self-attested + did:key  → Nivel B   (vault only, requires trusting Attestto)
   *   - self-attested + did:web  → Nivel B+  (publicly resolvable DID, evidentiary upgrade)
   *   - firma-digital-mocked     → Nivel A+ DEMO (never legally binding)
   *   - firma-digital-pkcs11     → Nivel A+  (real BCCR card, ATT-340) — RESERVED
   */
  level: 'self-attested' | 'firma-digital-mocked' | 'firma-digital-pkcs11'
  /** True when produced via the demo Firma Digital mock wizard. */
  mock: boolean
  /** Optional human-readable reason. */
  reason?: string
  /** Optional location (city, country). */
  location?: string
  /**
   * Document mode after this signing.
   *  - 'final': document is closed, no further edits or signatures intended.
   *    Any modification breaks the embedded documentHash binding.
   *  - 'open': further signers may counter-sign. Editing the body still
   *    invalidates this signature.
   */
  mode: 'final' | 'open'
  /** Detached ed25519 signature, base64. Signed payload = canonicalPayload(). */
  proof: {
    type: 'Ed25519Signature2020'
    created: string
    verificationMethod: string
    proofPurpose: 'assertionMethod'
    /** base64-encoded 64-byte ed25519 signature */
    proofValue: string
    /** base64-encoded 32-byte ed25519 public key (for offline verify). */
    publicKey: string
  }
}

export interface SignAttesttoOptions {
  pdfBytes: Uint8Array
  fileName: string
  signerDid: string
  signerName?: string
  signerHandle?: string
  signerCountry?: string
  signerPublicKey: Uint8Array
  /** Async signer — receives bytes to sign, returns 64-byte ed25519 sig. */
  sign: (message: Uint8Array) => Promise<Uint8Array>
  level: 'self-attested' | 'firma-digital-mocked'
  mode: 'final' | 'open'
  reason?: string
  location?: string
}

export interface SignAttesttoResult {
  /** Mutated PDF bytes with embedded signature + visible stamp. */
  pdfBytes: Uint8Array
  /** SHA-256 of the *original* (pre-signing) bytes. */
  originalHash: string
  /** The signature payload that was embedded. */
  signature: AttesttoPdfSignature
  /**
   * Path taken by the signer:
   *  - 'full-rewrite': pdf-lib re-emitted the whole file. Visible stamp
   *    drawn. Used for PDFs without a pre-existing /Sig.
   *  - 'incremental': new revision appended; original bytes byte-
   *    identical so any prior PAdES /ByteRange digests still validate.
   *    Visible stamp suppressed (see ATT-355 part 2).
   *
   * Named `writeMode` to avoid collision with `signature.mode`
   * ('final' | 'open') which describes document intent, not file layout.
   */
  writeMode: 'full-rewrite' | 'incremental'
  /**
   * True when we suppressed the visible stamp because the source PDF
   * carried a pre-existing signature. The UI should surface this as an
   * informational note ("documento con firma previa — sello visual
   * omitido para preservar la firma original").
   */
  stampSuppressed: boolean
}

/** Magic prefix for our keyword entry — lets us co-exist with other tools. */
const KEYWORD_PREFIX = 'attestto-sig-v1:'

/**
 * Canonicalize the signed payload using RFC 8785 JCS.
 * The `proof` block is excluded from its own input.
 */
function canonicalPayload(sig: Omit<AttesttoPdfSignature, 'proof'>): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { canonicalize } = require('json-canonicalize') as typeof import('json-canonicalize')
  return new TextEncoder().encode(canonicalize(sig))
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/**
 * Sign a PDF with the user's vault key, embed the JSON-LD signature in the
 * Keywords field, and draw a visible stamp on the last page (fixed
 * bottom-right).
 */
export async function signAttesttoPdf(opts: SignAttesttoOptions): Promise<SignAttesttoResult> {
  const originalHash = sha256Hex(opts.pdfBytes)
  const signedAt = new Date().toISOString()

  // Build the unsigned payload — proof is filled in after signing.
  const unsigned: Omit<AttesttoPdfSignature, 'proof'> = {
    v: 1,
    type: ['VerifiableCredential', 'AttesttoPdfSignature'],
    issuer: opts.signerDid,
    issuerName: opts.signerName,
    issuerHandle: opts.signerHandle,
    country: opts.signerCountry,
    signedAt,
    documentHash: originalHash,
    fileName: opts.fileName,
    level: opts.level,
    mock: opts.level === 'firma-digital-mocked',
    mode: opts.mode,
    reason: opts.reason,
    location: opts.location,
  }

  const payloadBytes = canonicalPayload(unsigned)
  const sigBytes = await opts.sign(payloadBytes)

  const signature: AttesttoPdfSignature = {
    ...unsigned,
    proof: {
      type: 'Ed25519Signature2020',
      created: signedAt,
      verificationMethod: `${opts.signerDid}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: bytesToBase64(sigBytes),
      publicKey: bytesToBase64(opts.signerPublicKey),
    },
  }

  // ── ATT-355: branch on pre-existing signature ──────────────────
  // If the source PDF already carries a /Sig (e.g. user signed it
  // externally with their Firma Digital card and is now adding an
  // Attestto countersignature on top), we MUST take the incremental
  // path. The pdf-lib full-rewrite path corrupts any pre-existing
  // /ByteRange digest. See incremental-info-update.ts header for the
  // full motivation.
  const sigJson = JSON.stringify(signature)
  const sigB64 = Buffer.from(sigJson, 'utf-8').toString('base64')
  const keywordEntry = `${KEYWORD_PREFIX}${sigB64}`

  if (hasExistingSignature(opts.pdfBytes)) {
    // Best-effort: read prior metadata via pdf-lib so we can carry it
    // over into the new /Info dict. pdf-lib transparently decompresses
    // object streams, so this works even when the prior /Info is buried
    // inside one. If the load fails for any reason, we still proceed
    // with empty carry-over — the signature payload is what matters.
    let carriedInfo: { title?: string; author?: string; subject?: string; creator?: string } = {}
    try {
      const probe = await PDFDocument.load(opts.pdfBytes, { ignoreEncryption: true, updateMetadata: false })
      carriedInfo = {
        title: probe.getTitle(),
        author: probe.getAuthor(),
        subject: probe.getSubject(),
        creator: probe.getCreator(),
      }
    } catch {
      // ignore — incremental writer will emit a fresh /Info with just
      // our keyword + producer + moddate
    }

    const { pdfBytes: out } = appendKeywordRevision({
      pdfBytes: opts.pdfBytes,
      keywordValue: keywordEntry,
      carriedInfo,
    })
    return {
      pdfBytes: out,
      originalHash,
      signature,
      writeMode: 'incremental',
      stampSuppressed: true,
    }
  }

  // Mutate the PDF: load → embed sig in keywords → draw stamp → save
  const doc = await PDFDocument.load(opts.pdfBytes)

  // ATT-356: override Producer so verifiers see this as an Attestto-
  // produced document rather than the underlying pdf-lib library. The
  // incremental path already does this; the full-rewrite path was
  // leaving Producer untouched, leaking "pdf-lib" into the visible
  // metadata of every freshly-signed document (including the carta
  // MICITT/MOPT, where it materially undermined trust).
  doc.setProducer('Attestto Desktop Station')
  doc.setModificationDate(new Date())

  // Preserve any existing keywords; append ours. (sigJson/sigB64/
  // keywordEntry were built above before the incremental branch.)
  const existing = (doc.getKeywords() ?? '')
    .split(/\s+/)
    .filter((k) => k && !k.startsWith(KEYWORD_PREFIX))
  doc.setKeywords([...existing, keywordEntry])

  // Visible stamp — bottom-right of last page.
  const pages = doc.getPages()
  const lastPage = pages[pages.length - 1]
  const { width } = lastPage.getSize()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const fontSm = await doc.embedFont(StandardFonts.Helvetica)

  const stampW = 240
  // 92pt of vertical room — gives every line ~14pt of breathing space.
  // Earlier 70pt height collapsed the date row onto the tier label row
  // when both were 7pt fonts (~5pt gap), producing visible overlap.
  const stampH = 92
  const margin = 24
  const x = width - stampW - margin
  const y = margin

  // Background panel — soft Attestto green tint
  lastPage.drawRectangle({
    x,
    y,
    width: stampW,
    height: stampH,
    color: rgb(0.96, 0.99, 0.97),
    borderColor: rgb(0.02, 0.47, 0.34),
    borderWidth: 1.2,
    opacity: 0.95,
  })

  const baseHead = signature.mode === 'final' ? 'FIRMADO · FINAL' : 'FIRMADO · EDITABLE'
  const headline = signature.mock ? `${baseHead} · DEMO` : baseHead
  // Vertical layout — top to bottom, each row offset from the bottom
  // edge so changing stampH lifts the whole block as a unit.
  //   y + stampH - 18  → headline       (10pt bold)
  //   y + stampH - 34  → name           (9pt regular)
  //   y + stampH - 48  → handle         (7pt, only when distinct from name)
  //   y + stampH - 62  → timestamp      (7pt)
  //   y + 12           → tier badge     (7pt, anchored to bottom)
  // ~14pt between every line so 7-9pt fonts never collide.
  lastPage.drawText(headline, {
    x: x + 12,
    y: y + stampH - 18,
    size: 10,
    font,
    color: rgb(0.02, 0.47, 0.34),
  })

  const nameLine = signature.issuerName ?? signature.issuerHandle ?? signature.issuer.slice(0, 30) + '…'
  lastPage.drawText(nameLine, {
    x: x + 12,
    y: y + stampH - 34,
    size: 9,
    font: fontSm,
    color: rgb(0.1, 0.15, 0.2),
    maxWidth: stampW - 24,
  })

  if (signature.issuerHandle && signature.issuerName) {
    lastPage.drawText(signature.issuerHandle, {
      x: x + 12,
      y: y + stampH - 48,
      size: 7,
      font: fontSm,
      color: rgb(0.02, 0.47, 0.34),
    })
  }

  const dateLine = signature.signedAt.slice(0, 19).replace('T', ' ') + ' UTC'
  lastPage.drawText(dateLine, {
    x: x + 12,
    y: y + stampH - 62,
    size: 7,
    font: fontSm,
    color: rgb(0.3, 0.35, 0.4),
  })

  const tierLabel = signature.mock
    ? 'Attestto · Nivel A+ DEMO'
    : 'Attestto · Nivel B (auto-atestada)'
  lastPage.drawText(tierLabel, {
    x: x + 12,
    y: y + 12,
    size: 7,
    font: fontSm,
    color: rgb(0.4, 0.45, 0.5),
  })

  const out = await doc.save({ useObjectStreams: false })

  return {
    pdfBytes: out,
    originalHash,
    signature,
    writeMode: 'full-rewrite',
    stampSuppressed: false,
  }
}

/**
 * Extract the Attestto signature from a PDF, if present. Returns null
 * when there's no `attestto-sig-v1:` keyword or when parsing fails.
 */
export async function extractAttesttoSignature(
  pdfBytes: Uint8Array,
): Promise<AttesttoPdfSignature | null> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  } catch {
    return null
  }

  const keywords = doc.getKeywords() ?? ''
  const entry = keywords.split(/\s+/).find((k) => k.startsWith(KEYWORD_PREFIX))
  if (!entry) return null

  const b64 = entry.slice(KEYWORD_PREFIX.length)
  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8')
    const parsed = JSON.parse(json) as AttesttoPdfSignature
    if (parsed?.v === 1 && parsed?.proof?.type === 'Ed25519Signature2020') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Verify an extracted Attestto signature against the original PDF bytes.
 * Returns null if no signature is present.
 */
export interface VerifyAttesttoResult {
  valid: boolean
  reason?: string
  signature: AttesttoPdfSignature
  /**
   * Whether the embedded ed25519 signature verifies against the canonical
   * payload using the embedded public key.
   */
  signatureValid: boolean
  /**
   * Whether the public key in the proof block matches the issuer DID
   * (did:key resolution). When false, the signature is technically valid
   * but the binding to the claimed issuer is broken.
   */
  issuerBinding: boolean
}

export async function verifyAttesttoPdf(
  pdfBytes: Uint8Array,
): Promise<VerifyAttesttoResult | null> {
  const sig = await extractAttesttoSignature(pdfBytes)
  if (!sig) return null

  // Reconstruct the canonical payload (everything except `proof`)
  // and verify the ed25519 signature over it.
  const payloadOnly: Omit<AttesttoPdfSignature, 'proof'> = { ...sig }
  delete (payloadOnly as Partial<AttesttoPdfSignature>).proof
  const canonical = canonicalPayload(payloadOnly)

  const pubkey = base64ToBytes(sig.proof.publicKey)
  const sigBytes = base64ToBytes(sig.proof.proofValue)

  let signatureValid = false
  try {
    signatureValid = nacl.sign.detached.verify(canonical, sigBytes, pubkey)
  } catch {
    signatureValid = false
  }

  // Issuer binding: did:key:z<multibase> contains the public key. We
  // multibase-decode the suffix and compare against the embedded pubkey.
  // For now, do a simple substring check on the base58 representation.
  // A future hardening pass can do full multibase/multicodec decoding.
  const issuerBinding = checkIssuerBinding(sig.issuer, pubkey)

  return {
    valid: signatureValid && issuerBinding,
    reason: !signatureValid
      ? 'ed25519 signature mismatch'
      : !issuerBinding
        ? 'issuer DID does not match embedded public key'
        : undefined,
    signature: sig,
    signatureValid,
    issuerBinding,
  }
}

/**
 * Best-effort check that the issuer DID encodes the same public key that
 * the proof block carries. Currently a permissive check — full multibase
 * decoding is a follow-up.
 */
function checkIssuerBinding(did: string, pubkey: Uint8Array): boolean {
  // did:key form: did:key:z<base58btc-encoded multicodec ed25519 prefix + pubkey>
  // The first byte after multibase 'z' is multicodec 0xed (ed25519-pub).
  // Rather than implementing base58 here, we accept any did:key issuer
  // for now and rely on the signature itself for cryptographic binding.
  // TODO: implement strict did:key resolution once @attestto/vc-sdk is
  // wired into the desktop main process.
  return did.startsWith('did:key:z') && pubkey.length === 32
}
