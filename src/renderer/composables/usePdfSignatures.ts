/**
 * PDF Signature Verification for desktop viewer.
 *
 * Thin wrapper around `@attestto/verify`'s canonical `verifyPdf` so the
 * desktop and the web widget always agree. The only thing this layer adds
 * is BCCR trust validation via the Electron main-process IPC bridge.
 *
 * Previously this file hand-copied `extractSignaturesFromBytes` from
 * verify and drifted out of sync. Don't do that again — fix the canonical
 * one in `attestto-verify/src/composables/pdf-verifier.ts` and re-export.
 */

import {
  verifyPdf as canonicalVerifyPdf,
  type PdfSignatureInfo as CanonicalPdfSignatureInfo,
} from '@attestto/verify'
import type { FirmaValidationResult } from '../../shared/firma-api'

export interface PdfSignatureInfo extends CanonicalPdfSignatureInfo {
  /** BCCR trust validation result, set when running inside Electron. */
  validation: FirmaValidationResult | null
}

/**
 * Attestto self-attested signature, embedded as a JSON-LD VC in the PDF
 * Keywords field. Detected and verified by the main-process IPC.
 *
 * This is parallel to PAdES signatures — a single PDF can carry both a
 * BCCR Firma Digital signature AND an Attestto Nivel B signature.
 */
export interface AttesttoSignatureSummary {
  valid: boolean
  signatureValid: boolean
  issuerBinding: boolean
  reason?: string
  signature: {
    issuer: string
    issuerName?: string
    issuerHandle?: string
    country?: string
    signedAt: string
    documentHash: string
    fileName: string
    level: 'self-attested' | 'firma-digital-mocked'
    mock: boolean
    mode: 'final' | 'open'
    reason?: string
    location?: string
    proof: { verificationMethod: string; publicKey: string }
  }
}

export interface PdfVerifyResult {
  signatures: PdfSignatureInfo[]
  hash: string
  /** Attestto-native signature if the PDF carries one. */
  attestto: AttesttoSignatureSummary | null
}

/**
 * Run BCCR trust validation against the main-process validator. No-op when
 * the bridge isn't present (e.g. running the renderer in a plain browser)
 * or when the signature has no PKCS#7 blob.
 */
async function validateAgainstBccr(sig: CanonicalPdfSignatureInfo): Promise<FirmaValidationResult | null> {
  const api = (window as unknown as {
    presenciaAPI?: { firma?: { validatePkcs7: (hex: string) => Promise<FirmaValidationResult> } }
  }).presenciaAPI
  if (!api?.firma?.validatePkcs7) return null
  if (!sig.pkcs7Hex) return null
  try {
    return await api.firma.validatePkcs7(sig.pkcs7Hex)
  } catch (err) {
    console.warn('[firma] validation IPC failed:', err)
    return null
  }
}

/**
 * Detect + verify Attestto-native signature via main IPC. Returns null when
 * the PDF doesn't carry one or when the IPC bridge is missing (renderer
 * running outside Electron).
 */
async function verifyAttesttoSignature(bytes: Uint8Array): Promise<AttesttoSignatureSummary | null> {
  const api = (window as unknown as {
    presenciaAPI?: { pdf?: { verifyAttestto: (params: { pdfBytes: Uint8Array }) => Promise<AttesttoSignatureSummary | null> } }
  }).presenciaAPI
  if (!api?.pdf?.verifyAttestto) return null
  try {
    return await api.pdf.verifyAttestto({ pdfBytes: bytes.slice() })
  } catch (err) {
    console.warn('[attestto-sig] verify IPC failed:', err)
    return null
  }
}

export async function verifyPdfSignatures(bytes: Uint8Array, fileName: string): Promise<PdfVerifyResult> {
  // Canonical verifier takes a File. Wrap our bytes — copies the buffer so
  // the original Uint8Array stays safe from any worker transfers downstream.
  const file = new File([bytes.slice()], fileName, { type: 'application/pdf' })

  // Run BCCR/PAdES verification and Attestto-native verification in parallel.
  const [canonical, attestto] = await Promise.all([
    canonicalVerifyPdf(file),
    verifyAttesttoSignature(bytes),
  ])

  const signatures: PdfSignatureInfo[] = await Promise.all(
    canonical.signatures.map(async (sig: CanonicalPdfSignatureInfo) => ({
      ...sig,
      validation: await validateAgainstBccr(sig),
    })),
  )

  return { signatures, hash: canonical.hash, attestto }
}
