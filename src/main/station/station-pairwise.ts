import nacl from 'tweetnacl'
import { stationKeys } from './station-keys'

/**
 * StationPairwise — per-credential pairwise sub-keys with master-signed delegation.
 *
 * Each credential issued by the station gets a FRESH random ed25519 sub-keypair.
 * The sub-key signs the credential `proof.proofValue`. The station's master key
 * signs a `delegationProof` binding (sub_pubkey || credentialId || createdAt) so
 * a verifier can walk the trust chain:
 *
 *     credential.proof.proofValue       ← signed by sub-key
 *         verifies against → sub_pubkey (in proof.verificationMethod)
 *     credential.proof.delegationProof  ← signed by station master key
 *         verifies against → station master pubkey (in DID document)
 *     station DID document              ← anchored at:
 *         did:sns:station-<id>.attestto.sol
 *         did:web:attestto.id:stations:<id>
 *
 * The sub-secret is **discarded immediately** after signing — we never persist
 * it. This gives forward secrecy at the sub-key level: even a future compromise
 * of the station storage cannot reproduce a sub-key sig from the past.
 *
 * Unlinkability properties this delivers:
 *   - Two credentials from the same station have unrelated sub-DIDs
 *   - A passive observer cannot correlate two credentials by their issuer field
 *   - Only a verifier who explicitly walks the delegationProof chain can prove
 *     "these came from the same station" — and they can only do that if they
 *     have access to BOTH credentials at once
 */

export interface PairwiseProof {
  /** The fresh per-credential ed25519 public key, raw 32 bytes */
  subPublicKey: Uint8Array
  /** Detached ed25519 signature over the canonicalized credential body */
  proofValue: Uint8Array
  /** Detached ed25519 signature by the station master over the binding tuple */
  delegationProof: Uint8Array
  /** Exact bytes that delegationProof was computed over (for verifier replay) */
  delegationBinding: Uint8Array
  /** ISO timestamp embedded in the delegation binding */
  createdAt: string
}

/**
 * Sign a credential body with a fresh pairwise sub-key and produce the
 * delegation proof linking the sub-key to the station master.
 *
 * @param credentialId  Stable ID of the credential being signed (used as
 *                      domain separator inside the delegation binding)
 * @param messageBytes  Canonicalized bytes of the credential body to sign
 *                      (caller decides the canonicalization; this function
 *                      just signs whatever bytes it gets)
 */
export function signWithPairwiseKey(
  credentialId: string,
  messageBytes: Uint8Array,
): PairwiseProof {
  // 1. Fresh sub-keypair, used exactly once.
  const sub = nacl.sign.keyPair()
  const subSecret = sub.secretKey // 64 bytes (seed || pubkey) per nacl convention
  const subPublicKey = sub.publicKey

  // 2. Sign the credential body with the sub-key.
  const proofValue = nacl.sign.detached(messageBytes, subSecret)

  // 3. Build the delegation binding the master will sign.
  //    Format: utf8("attestto-station-delegation/v1/") || credentialId || 0x00 || createdAt || 0x00 || subPublicKey
  //    Domain separator + clear field separators prevent collision with other sigs.
  const createdAt = new Date().toISOString()
  const delegationBinding = buildDelegationBinding(credentialId, createdAt, subPublicKey)

  // 4. Sign the delegation with the station MASTER key.
  //    nacl.sign.detached needs the 64-byte expanded secret; rebuild from the
  //    32-byte seed we keep on disk.
  const masterSeed = stationKeys.getSecretKey() // 32 bytes
  const masterKp = nacl.sign.keyPair.fromSeed(masterSeed)
  const delegationProof = nacl.sign.detached(delegationBinding, masterKp.secretKey)

  // 5. Wipe the sub-secret. JavaScript can't truly zero memory, but at least
  //    drop the reference so the GC can reclaim it and we never accidentally
  //    persist it.
  subSecret.fill(0)

  return {
    subPublicKey,
    proofValue,
    delegationProof,
    delegationBinding,
    createdAt,
  }
}

/**
 * Build the exact byte sequence that the station master signs in a delegation
 * proof. Exposed for verifier-side replay (a verifier reconstructs this binding
 * from the credential fields and re-checks the master signature against it).
 */
export function buildDelegationBinding(
  credentialId: string,
  createdAt: string,
  subPublicKey: Uint8Array,
): Uint8Array {
  const domain = Buffer.from('attestto-station-delegation/v1/', 'utf8')
  const idBytes = Buffer.from(credentialId, 'utf8')
  const tsBytes = Buffer.from(createdAt, 'utf8')
  const sep = Buffer.from([0x00])
  return new Uint8Array(
    Buffer.concat([domain, idBytes, sep, tsBytes, sep, Buffer.from(subPublicKey)]),
  )
}

/**
 * Verifier-side helper: given a credential's pairwise proof + the station's
 * known master pubkey, verify both signatures.
 *
 * Returns:
 *   - subSignatureValid:    proofValue is a valid sig over messageBytes by subPublicKey
 *   - delegationValid:      delegationProof is a valid sig over the rebuilt binding
 *                            by the station master key
 *
 * Both must be true for the credential to be considered station-issued.
 */
export function verifyPairwiseProof(
  proof: PairwiseProof,
  messageBytes: Uint8Array,
  credentialId: string,
  stationMasterPublicKey: Uint8Array,
): { subSignatureValid: boolean; delegationValid: boolean } {
  const subSignatureValid = nacl.sign.detached.verify(
    messageBytes,
    proof.proofValue,
    proof.subPublicKey,
  )
  const expectedBinding = buildDelegationBinding(credentialId, proof.createdAt, proof.subPublicKey)
  // The binding stored on the proof must match what we'd reconstruct — defends
  // against an attacker swapping the binding bytes for ones the master had
  // signed in a different context.
  const bindingMatches =
    expectedBinding.length === proof.delegationBinding.length &&
    expectedBinding.every((b, i) => b === proof.delegationBinding[i])
  const delegationSigValid = nacl.sign.detached.verify(
    proof.delegationBinding,
    proof.delegationProof,
    stationMasterPublicKey,
  )
  return {
    subSignatureValid,
    delegationValid: bindingMatches && delegationSigValid,
  }
}
