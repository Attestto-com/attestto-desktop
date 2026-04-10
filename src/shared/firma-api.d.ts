/**
 * Shared types for the Firma Digital validator IPC bridge.
 *
 * The validator runs in the main process (Node) because it needs:
 *   - filesystem access to bundled BCCR root CAs
 *   - X.509 chain validation
 *   - OCSP HTTP fetches against ocsp.sinpe.fi.cr
 *
 * The renderer calls it via window.presenciaAPI.firma.validatePkcs7(hex).
 */

/** Origin of a trust anchor inside the bundled trust store. */
export type TrustAnchorOrigin = 'bccr' | 'attestto' | string

/** Result of validating a PKCS#7 / CMS signature blob against the bundled trust store. */
export interface FirmaValidationResult {
  /** True only if the chain validates to a bundled root AND OCSP is good. */
  trusted: boolean

  /** Chain status: did the cert chain build successfully and verify against a bundled root? */
  chain:
    | { status: 'valid'; rootSubject: string; rootOrigin: TrustAnchorOrigin }
    | { status: 'untrusted-root'; reason: string }
    | { status: 'expired'; reason: string }
    | { status: 'incomplete'; reason: string }
    | { status: 'no-roots-bundled'; reason: string }
    | { status: 'parse-error'; reason: string }

  /** OCSP revocation status. */
  ocsp:
    | { status: 'good'; checkedAt: string; producedAt: string | null }
    | { status: 'revoked'; checkedAt: string; reason: string | null }
    | { status: 'unknown'; checkedAt: string }
    | { status: 'offline'; checkedAt: string }
    | { status: 'not-checked'; reason: string }

  /** Human-readable single-line summary suitable for the UI badge. */
  summary: string

  /** Diagnostic detail for the expanded panel. */
  diagnostics: string[]
}

export interface FirmaApi {
  /** Validate a PKCS#7 (CMS SignedData) hex blob from a PDF signature dictionary. */
  validatePkcs7(pkcs7Hex: string): Promise<FirmaValidationResult>

  /** Returns true once at least one BCCR root CA has been bundled into the app. */
  rootsLoaded(): Promise<boolean>
}
