import nacl from 'tweetnacl'
import { stationKeys } from './station-keys'
import { signWithPairwiseKey, type PairwiseProof } from './station-pairwise'

/**
 * StationService — public API for the per-install Attestto station identity.
 *
 * This is the ONLY surface other parts of the main process should touch.
 * It hides the master key behind a small set of well-defined operations:
 *
 *     getStationDid()      → identifiers for the station as the issuer of VCs
 *     getPublicKey()       → 32-byte master pubkey (for DID document publishing)
 *     signCredential()     → high-level: sign a VC body with a fresh pairwise sub-key
 *     signRaw()            → low-level: detached ed25519 sig with the master key
 *
 * The master key NEVER leaves this module. Callers receive signatures and
 * pubkeys, not the secret bytes.
 *
 * Per `project_attestto_pay_model.md`, this key is identity-only. It cannot
 * move money, cannot broadcast Solana transactions, cannot hold a balance.
 * Financial operations live in CORTEX + Circle.
 */

/** The set of identifiers that resolve to this station. */
export interface StationDids {
  /** Primary on-chain alias-anchored DID (resolves via SNS to the station's DID document) */
  sns: string
  /** Web2 mirror (resolves via HTTPS at attestto.id/.well-known/did.json + station path) */
  web: string
  /** Raw key-based DID for verifiers who don't want to resolve aliases */
  key: string
}

export class StationService {
  /** Lazily resolves to a stable per-install identifier derived from the master pubkey. */
  private cachedStationId: string | null = null

  /**
   * Initialize the station identity. Generates the master keypair on first
   * call. Idempotent. Should be called once during main-process startup so
   * the keypair exists before any IPC handler can be invoked.
   */
  init(): void {
    stationKeys.loadOrCreate()
  }

  /** Returns the 32-byte ed25519 master public key. */
  getPublicKey(): Uint8Array {
    return stationKeys.getPublicKey()
  }

  /** ISO timestamp the station was first provisioned on this install. */
  getCreatedAt(): string {
    return stationKeys.getCreatedAt()
  }

  /**
   * Returns the stable per-install station identifier.
   *
   * Derived as the first 16 chars of base64url(masterPublicKey) — short enough
   * to be readable in a URL, long enough to be effectively unique across the
   * lifetime of the install. Deterministic from the pubkey, so the alias is
   * stable for as long as the keypair exists.
   *
   * To revoke: delete `${userData}/station/station-sign.enc`. Next launch will
   * generate a fresh keypair, producing a fresh station ID and a fresh DID.
   * Prior credentials remain verifiable because they reference the OLD pubkey
   * in their proof block.
   */
  getStationId(): string {
    if (this.cachedStationId) return this.cachedStationId
    const pubkey = this.getPublicKey()
    const b64u = Buffer.from(pubkey).toString('base64url')
    this.cachedStationId = b64u.slice(0, 16)
    return this.cachedStationId
  }

  /**
   * Returns the three DID forms for this station.
   *
   *   sns:  did:sns:station-<id>.attestto.sol      (Web3 anchor)
   *   web:  did:web:attestto.id:stations:<id>      (Web2 anchor)
   *   key:  did:key:z<base64url-multicodec-pubkey> (raw)
   *
   * The sns and web forms are the canonical issuer references. They both point
   * to DID documents that publish this station's master pubkey under
   * `assertionMethod`, with cross-references to each other via `alsoKnownAs`.
   *
   * The key form is included so verifiers who don't trust either rail can
   * still verify a credential by walking the raw pubkey directly.
   */
  getStationDid(): StationDids {
    const id = this.getStationId()
    return {
      sns: `did:sns:station-${id}.attestto.sol`,
      web: `did:web:attestto.id:stations:${id}`,
      key: this.publicKeyToDidKey(this.getPublicKey()),
    }
  }

  /**
   * Sign a credential body with a fresh pairwise sub-key.
   *
   * The sub-key is generated on the fly, used once, and discarded. The
   * returned `PairwiseProof` contains everything a verifier needs to walk the
   * delegation chain back to this station's master key (which they look up
   * via the station DID document).
   *
   * @param credentialId  Stable VC `id` field (used as the domain separator
   *                       inside the delegation binding)
   * @param messageBytes  The exact bytes a verifier will re-canonicalize and
   *                       check against `proof.proofValue`. Caller is
   *                       responsible for canonicalization (JCS, RDF
   *                       canonical, or whatever the credential type uses).
   */
  signCredential(credentialId: string, messageBytes: Uint8Array): PairwiseProof {
    return signWithPairwiseKey(credentialId, messageBytes)
  }

  /**
   * Detached ed25519 signature with the station MASTER key.
   *
   * Use sparingly — most callers should use `signCredential` instead so the
   * master key never directly appears in user-visible signatures. Reserved for
   * cases where a verifier explicitly needs a master signature (e.g. mesh
   * handshake, audit log entries that bind a chain of credentials together,
   * delegation to a relayer).
   */
  signRaw(messageBytes: Uint8Array): Uint8Array {
    const seed = stationKeys.getSecretKey() // 32 bytes
    const kp = nacl.sign.keyPair.fromSeed(seed)
    return nacl.sign.detached(messageBytes, kp.secretKey)
  }

  // ── private ──────────────────────────────────────────

  /**
   * Convert a raw 32-byte ed25519 pubkey to a `did:key:z…` string.
   *
   * Mirrors `vault-service.ts`'s convention (multicodec ed25519 prefix
   * 0xed01, then base64url, with a leading `z`). Note: the `z` prefix is
   * technically multibase base58btc, but the rest of the desktop app uses
   * base64url under the same prefix; we match that here so the two services
   * produce mutually-resolvable identifiers. Spec-compliance cleanup is a
   * separate task.
   */
  private publicKeyToDidKey(publicKey: Uint8Array): string {
    const multicodec = new Uint8Array([0xed, 0x01, ...publicKey])
    const encoded = Buffer.from(multicodec).toString('base64url')
    return `did:key:z${encoded}`
  }
}

export const stationService = new StationService()
