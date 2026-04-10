import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import nacl from 'tweetnacl'

/**
 * StationKeys — the per-install ed25519 signing keypair for this Attestto station.
 *
 * THIS KEY IS IDENTITY, NOT FINANCE.
 *
 *   ✓ Signs VC `proof` blocks (as the issuer of attestations)
 *   ✓ Signs mesh PUT metadata
 *   ✓ Signs audit log entries
 *   ✗ NEVER holds funds
 *   ✗ NEVER broadcasts a Solana transaction
 *   ✗ NEVER appears as the `from` address of any on-chain tx
 *
 * Per `project_attestto_pay_model.md`, financial operations live in CORTEX +
 * Circle dev-managed accounts. The desktop NEVER imports `@solana/web3.js` for
 * value transfer. The user signs payment intents with their identity DID;
 * CORTEX moves funds on their behalf.
 *
 * Storage:
 *   - Single keypair, generated at first launch
 *   - Stored at `${userData}/station/station-sign.enc`
 *   - Encrypted at rest via Electron `safeStorage` (Keychain on macOS,
 *     DPAPI on Windows, libsecret on Linux)
 *   - Lives OUTSIDE the user vault — the station persists across user
 *     logout/lock and may need to sign before vault unlock (e.g. mesh handshake)
 *
 * Recovery:
 *   - NOT backed up. If the station is destroyed, prior credentials remain
 *     verifiable because the station's pubkey is published in its DID document
 *     (did:sns:station-<id>.attestto.sol / did:web:attestto.id:stations:<id>).
 *     A reinstall generates a fresh keypair → fresh station DID.
 */

interface StationKeyMaterial {
  /** 32-byte ed25519 secret key (raw, not the 64-byte expanded form) */
  secretKey: Uint8Array
  /** 32-byte ed25519 public key */
  publicKey: Uint8Array
  /** ISO timestamp this keypair was first generated on this install */
  createdAt: string
}

interface StationKeyEnvelopeV1 {
  version: 1
  algorithm: 'ed25519'
  /** base64 of the 32-byte raw secret key, encrypted with safeStorage */
  encryptedSecretKey: string
  /** base64 of the 32-byte public key (not secret, stored as-is for fast access) */
  publicKey: string
  createdAt: string
}

export class StationKeys {
  private cached: StationKeyMaterial | null = null

  private get dir(): string {
    const d = join(app.getPath('userData'), 'station')
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
    return d
  }

  private get envelopePath(): string {
    return join(this.dir, 'station-sign.enc')
  }

  /** True iff a station keypair has been generated on this install. */
  exists(): boolean {
    return existsSync(this.envelopePath)
  }

  /**
   * Load the station keypair, generating one on first call.
   * Idempotent — subsequent calls return the cached material.
   */
  loadOrCreate(): StationKeyMaterial {
    if (this.cached) return this.cached

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        '[station-keys] OS keychain (safeStorage) is not available. ' +
        'The station signing key requires Keychain (macOS), DPAPI (Windows), ' +
        'or libsecret (Linux) to be available.',
      )
    }

    if (this.exists()) {
      this.cached = this.read()
      return this.cached
    }

    this.cached = this.generate()
    this.write(this.cached)
    return this.cached
  }

  /** Returns the public key bytes. Generates the keypair if needed. */
  getPublicKey(): Uint8Array {
    return this.loadOrCreate().publicKey
  }

  /** Returns the raw 32-byte secret key. Generates the keypair if needed. */
  getSecretKey(): Uint8Array {
    return this.loadOrCreate().secretKey
  }

  /** ISO timestamp the station was first provisioned. */
  getCreatedAt(): string {
    return this.loadOrCreate().createdAt
  }

  // ── private ──────────────────────────────────────────

  private generate(): StationKeyMaterial {
    // tweetnacl.sign.keyPair() returns a 64-byte secretKey (seed || pubkey).
    // Per nacl convention, the first 32 bytes are the seed; we store only the
    // seed and re-derive the full keypair on demand.
    const kp = nacl.sign.keyPair()
    return {
      secretKey: kp.secretKey.slice(0, 32),
      publicKey: kp.publicKey,
      createdAt: new Date().toISOString(),
    }
  }

  private read(): StationKeyMaterial {
    const raw = readFileSync(this.envelopePath, 'utf8')
    const env = JSON.parse(raw) as StationKeyEnvelopeV1
    if (env.version !== 1 || env.algorithm !== 'ed25519') {
      throw new Error(`[station-keys] unsupported envelope: v${env.version}/${env.algorithm}`)
    }
    const encrypted = Buffer.from(env.encryptedSecretKey, 'base64')
    const decryptedSeed = safeStorage.decryptString(encrypted)
    const secretKey = Buffer.from(decryptedSeed, 'base64')
    if (secretKey.length !== 32) {
      throw new Error('[station-keys] decrypted secret key is the wrong length')
    }
    return {
      secretKey: new Uint8Array(secretKey),
      publicKey: new Uint8Array(Buffer.from(env.publicKey, 'base64')),
      createdAt: env.createdAt,
    }
  }

  private write(material: StationKeyMaterial): void {
    const seedB64 = Buffer.from(material.secretKey).toString('base64')
    const encrypted = safeStorage.encryptString(seedB64)
    const env: StationKeyEnvelopeV1 = {
      version: 1,
      algorithm: 'ed25519',
      encryptedSecretKey: encrypted.toString('base64'),
      publicKey: Buffer.from(material.publicKey).toString('base64'),
      createdAt: material.createdAt,
    }
    writeFileSync(this.envelopePath, JSON.stringify(env, null, 2), 'utf8')
    // Lock down file permissions on POSIX so other local users can't read it.
    try {
      chmodSync(this.envelopePath, 0o600)
    } catch {
      // Windows: chmod is a no-op, that's fine
    }
  }
}

export const stationKeys = new StationKeys()
