import { split, combine } from 'shamir-secret-sharing'
import nacl from 'tweetnacl'
import { vaultService } from './vault-service'
import { meshService } from '../mesh/service'

/**
 * Sign the recovery shard's identifying tuple with the user's ed25519 key.
 * Binds (didOwner, path, version, blobHash) so a guardian — or anyone on the
 * mesh — can verify the shard came from the user and hasn't been swapped.
 */
function signShardMetadata(
  privateKeyHex: string,
  didOwner: string,
  path: string,
  version: number,
  blob: Uint8Array,
): string {
  const blobHash = nacl.hash(blob) // SHA-512
  const message = Buffer.concat([
    Buffer.from(`${didOwner}|${path}|${version}|`, 'utf8'),
    Buffer.from(blobHash),
  ])
  const secretKey = Buffer.from(privateKeyHex, 'hex')
  const signature = nacl.sign.detached(message, secretKey)
  return Buffer.from(signature).toString('hex')
}

/**
 * GuardianService — Shamir Secret Sharing + mesh distribution for social recovery.
 *
 * Encrypt-then-split: the vault is encrypted BEFORE splitting into shards.
 * Two colluding guardians can reconstruct the ciphertext but cannot decrypt
 * without the user's passphrase. Shamir itself is information-theoretically
 * secure (quantum-safe).
 */
export class GuardianService {
  /**
   * Backup vault to guardians via the mesh.
   * Splits encrypted vault into 3 shards (threshold 2) and PUTs each
   * to a guardian's mesh namespace.
   */
  async backup(): Promise<{ success: boolean; version: number }> {
    const contents = vaultService.read()
    if (!contents) throw new Error('Vault is locked')
    if (!contents.guardians.configured) throw new Error('Guardians not configured')

    const encryptedBytes = vaultService.getEncryptedBytes()
    if (!encryptedBytes) throw new Error('Cannot read vault')

    // Split into 3 shards, threshold 2
    const shards = await split(encryptedBytes, 3, 2)
    const userDid = contents.identity.did
    const protocol = meshService.getProtocol()
    const version = contents.guardians.backupVersion + 1

    // PUT each shard to the guardian's mesh namespace
    const privateKeyHex = contents.identity.privateKeyHex
    for (let i = 0; i < contents.guardians.guardianDids.length; i++) {
      const guardianDid = contents.guardians.guardianDids[i]
      const path = `recovery/${userDid}/shard`
      const signature = signShardMetadata(privateKeyHex, guardianDid, path, version, shards[i])
      await protocol.put(
        {
          didOwner: guardianDid,
          path,
          version,
          ttlSeconds: 0, // permanent
          signature,
          solanaAnchor: null,
        },
        shards[i],
      )
    }

    // Update vault with backup metadata
    vaultService.write({
      guardians: {
        ...contents.guardians,
        lastBackupAt: Date.now(),
        backupVersion: version,
      },
    })

    return { success: true, version }
  }

  /**
   * Verify that a recovered shard's signature matches the expected signer.
   * Prevents mesh poisoning where an attacker substitutes a crafted shard.
   */
  private verifyShard(
    publicKeyHex: string,
    guardianDid: string,
    path: string,
    version: number,
    blob: Uint8Array,
    signatureHex: string,
  ): boolean {
    const blobHash = nacl.hash(blob) // SHA-512
    const message = Buffer.concat([
      Buffer.from(`${guardianDid}|${path}|${version}|`, 'utf8'),
      Buffer.from(blobHash),
    ])
    const publicKey = Buffer.from(publicKeyHex, 'hex')
    const signature = Buffer.from(signatureHex, 'hex')
    return nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(signature),
      new Uint8Array(publicKey),
    )
  }

  /**
   * Recover vault from guardian shards.
   * GETs shards from at least 2 guardians, verifies their signatures,
   * combines via Shamir, then restores the vault using the user's passphrase.
   */
  async recover(
    passphrase: string,
    userDid: string,
    guardianDids: string[],
    userPublicKeyHex?: string,
  ): Promise<boolean> {
    if (guardianDids.length < 2) throw new Error('Need at least 2 guardian DIDs')

    const protocol = meshService.getProtocol()
    const shards: Uint8Array[] = []

    // Fetch shards from guardians via mesh, verify signatures before accepting
    for (const guardianDid of guardianDids) {
      const path = `recovery/${userDid}/shard`
      const result = await protocol.get(guardianDid, path)
      if (result) {
        // Verify shard signature if public key is available
        if (userPublicKeyHex && result.metadata.signature) {
          const valid = this.verifyShard(
            userPublicKeyHex, guardianDid, path,
            result.metadata.version, result.blob, result.metadata.signature,
          )
          if (!valid) {
            console.warn(`Shard from ${guardianDid} failed signature verification — skipping`)
            continue
          }
        }
        shards.push(result.blob)
      }
      if (shards.length >= 2) break // threshold met
    }

    if (shards.length < 2) {
      throw new Error(`Only recovered ${shards.length} shard(s), need at least 2`)
    }

    // Combine shards to reconstruct encrypted vault envelope
    const encryptedBytes = await combine(shards)

    // Restore vault from encrypted bytes + passphrase
    return vaultService.restoreFromBytes(encryptedBytes, passphrase)
  }
}

/** Singleton */
export const guardianService = new GuardianService()
