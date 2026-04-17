/**
 * Station API — types crossing the IPC boundary between main and renderer.
 *
 * The renderer never receives the master secret key. Only public material
 * (pubkeys, signatures, DIDs) crosses the boundary.
 *
 * See `src/main/station/station-service.ts` for the implementation and
 * `project_attestto_pay_model.md` for the architectural rationale.
 */

/** The set of identifiers that resolve to this station. */
export interface StationDids {
  /** Primary on-chain alias-anchored DID (Web3) */
  sns: string
  /** Web2 mirror (HTTPS-resolvable) */
  web: string
  /** Raw key-based DID for verifiers who don't trust either alias rail */
  key: string
}

/** Lightweight info block the renderer can show in an "advanced" view. */
export interface StationInfo {
  /** All three DID forms */
  dids: StationDids
  /** Base64 of the 32-byte master public key */
  publicKeyB64: string
  /** ISO timestamp the station was first provisioned on this install */
  createdAt: string
  /** Stable per-install identifier (also embedded in the DIDs) */
  stationId: string
}

/**
 * The pairwise proof block returned by `signCredential`. All byte fields are
 * base64-encoded for IPC transport (Uint8Array marshalling across the
 * contextBridge is unreliable across Electron versions, so we use strings).
 */
export interface PairwiseProofWire {
  /** base64 — fresh per-credential ed25519 public key (32 bytes) */
  subPublicKeyB64: string
  /** base64 — detached ed25519 signature over the canonicalized credential body */
  proofValueB64: string
  /** base64 — detached ed25519 signature by the master over the delegation binding */
  delegationProofB64: string
  /** base64 — exact bytes the delegation proof was computed over (for verifier replay) */
  delegationBindingB64: string
  /** ISO timestamp embedded inside the delegation binding */
  createdAt: string
}

/**
 * Parameters for `signCredential`. The renderer provides the credential ID and
 * the canonicalized credential body bytes; the main process returns a wire-form
 * pairwise proof.
 */
export interface StationSignCredentialParams {
  credentialId: string
  /** base64 of the canonicalized message bytes to sign */
  messageB64: string
}

/**
 * 2-step signing flow — eliminates the canonicalIssuerPlaceholder kludge.
 *
 * Step 1: `prepareCredential` → generates the sub-key, signs the delegation,
 *   holds the sub-secret in memory, returns the sub-public-key so the renderer
 *   can derive the issuer DID and build the credential body with real issuer.
 *
 * Step 2: `finalizeCredential` → renderer sends the JCS-canonicalized body,
 *   main process signs it with the held sub-secret, wipes it, returns the
 *   signature.
 */
export interface StationPrepareResult {
  /** base64 — fresh per-credential ed25519 public key (32 bytes) */
  subPublicKeyB64: string
  /** base64 — delegation proof signed by station master */
  delegationProofB64: string
  /** base64 — delegation binding bytes (for verifier replay) */
  delegationBindingB64: string
  /** ISO timestamp */
  createdAt: string
}

export interface StationFinalizeParams {
  credentialId: string
  /** base64 of the JCS-canonicalized credential body */
  messageB64: string
}

export interface StationFinalizeResult {
  /** base64 — detached ed25519 signature over the canonicalized body */
  proofValueB64: string
}
