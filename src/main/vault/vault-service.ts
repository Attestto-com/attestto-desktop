import { app, safeStorage, systemPreferences } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { randomBytes, hkdfSync } from 'node:crypto'
import nacl from 'tweetnacl'
import type { VaultEnvelope, VaultContents, VaultIdentity, EncryptedArtifact } from '../../shared/vault-api'

/**
 * VaultService — encrypted local vault with passkey-style UX.
 *
 * No passwords. The vault key is a random 32-byte key protected by the OS keychain
 * via Electron's safeStorage API (Keychain on macOS, Credential Manager on Windows,
 * libsecret on Linux). Authentication uses biometric (Touch ID / Windows Hello)
 * when available.
 *
 * The envelope format is algorithm-agile for future post-quantum migration.
 * Current suite: xsalsa20-poly1305 (encryption) + ed25519 (identity)
 */

const CRYPTO_SUITE = 'xsalsa20-poly1305+ed25519'
const AUTO_LOCK_MS = 5 * 60 * 1000 // 5 minutes

export class VaultService {
  private vaultKey: Uint8Array | null = null
  private contents: VaultContents | null = null
  private lastAccessAt = 0
  private autoLockTimer: ReturnType<typeof setInterval> | null = null
  private lockListeners: Array<() => void> = []

  private get dataDir(): string {
    const dir = join(app.getPath('userData'), 'vault')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  private get envelopePath(): string {
    return join(this.dataDir, 'vault.enc')
  }

  private get keyPath(): string {
    return join(this.dataDir, 'vault.key')
  }

  // ── Public API ───────────────────────────────────

  exists(): boolean {
    return existsSync(this.envelopePath) && existsSync(this.keyPath)
  }

  get isUnlocked(): boolean {
    return this.vaultKey !== null && this.contents !== null
  }

  /**
   * Create a new vault. No password needed — key is protected by OS keychain.
   */
  async create(): Promise<VaultContents> {
    if (this.exists()) throw new Error('Vault already exists')

    // Generate random vault key
    const key = randomBytes(32)

    // Protect key with OS keychain via safeStorage
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS keychain (safeStorage) is not available. ' +
        'On Linux, install libsecret (e.g. gnome-keyring). ' +
        'Vault creation requires OS-level key protection.',
      )
    }
    const encrypted = safeStorage.encryptString(key.toString('hex'))
    writeFileSync(this.keyPath, encrypted)

    // Generate identity keypair
    const keyPair = nacl.sign.keyPair()
    const identity: VaultIdentity = {
      did: this.publicKeyToDid(keyPair.publicKey),
      publicKeyHex: Buffer.from(keyPair.publicKey).toString('hex'),
      privateKeyHex: Buffer.from(keyPair.secretKey).toString('hex'),
      algorithm: 'ed25519',
    }

    const now = Date.now()
    const contents: VaultContents = {
      version: 1,
      createdAt: now,
      updatedAt: now,
      identity,
      persona: {
        type: 'citizen',
        installedModules: [],
        pinnedActions: [],
        activityLog: [],
        onboardingComplete: false,
      },
      settings: {
        solanaNetwork: 'devnet',
        language: 'es',
      },
      credentials: [],
      biometrics: [],
      verificationSessions: [],
      guardians: {
        configured: false,
        threshold: 2,
        guardianDids: [],
        backupVersion: 0,
      },
    }

    this.vaultKey = new Uint8Array(key)
    this.contents = contents
    this.writeToDisk()
    this.touch()
    this.startAutoLock()

    return contents
  }

  /**
   * Unlock vault. Uses biometric (Touch ID) on macOS, falls back to OS keychain.
   */
  async unlock(): Promise<boolean> {
    if (!this.exists()) return false

    // On macOS, prompt Touch ID if available
    if (process.platform === 'darwin') {
      try {
        await systemPreferences.promptTouchID('Desbloquear Attestto')
      } catch {
        return false // User cancelled or Touch ID failed
      }
    }

    try {
      // Read vault key from OS keychain
      const keyData = readFileSync(this.keyPath)
      let keyHex: string

      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS keychain (safeStorage) is not available — cannot unlock vault securely')
      }
      keyHex = safeStorage.decryptString(keyData)

      const key = new Uint8Array(Buffer.from(keyHex, 'hex'))

      // Read and decrypt envelope
      const envelope: VaultEnvelope = JSON.parse(readFileSync(this.envelopePath, 'utf-8'))
      const nonce = Buffer.from(envelope.nonce, 'hex')
      const ciphertext = Buffer.from(envelope.ciphertext, 'hex')

      const plaintext = nacl.secretbox.open(
        new Uint8Array(ciphertext),
        new Uint8Array(nonce),
        key,
      )

      if (!plaintext) return false

      this.vaultKey = key
      this.contents = JSON.parse(new TextDecoder().decode(plaintext))
      this.touch()
      this.startAutoLock()
      return true
    } catch {
      return false
    }
  }

  lock(): void {
    if (this.vaultKey) {
      this.vaultKey.fill(0)
      this.vaultKey = null
    }
    this.contents = null
    this.stopAutoLock()

    for (const listener of this.lockListeners) {
      listener()
    }
  }

  read(): VaultContents | null {
    if (!this.isUnlocked) return null
    this.touch()
    return structuredClone(this.contents!)
  }

  write(partial: Partial<VaultContents>): void {
    if (!this.isUnlocked || !this.contents || !this.vaultKey) {
      throw new Error('Vault is locked')
    }

    if (partial.persona) this.contents.persona = { ...this.contents.persona, ...partial.persona }
    if (partial.settings) this.contents.settings = { ...this.contents.settings, ...partial.settings }
    if (partial.credentials) this.contents.credentials = partial.credentials
    if (partial.guardians) this.contents.guardians = { ...this.contents.guardians, ...partial.guardians }
    if (partial.identity) this.contents.identity = { ...this.contents.identity, ...partial.identity }
    if (partial.biometrics) this.contents.biometrics = partial.biometrics
    if (partial.verificationSessions) this.contents.verificationSessions = partial.verificationSessions
    this.contents.updatedAt = Date.now()

    this.writeToDisk()
    this.touch()
  }

  getDid(): string | null {
    return this.contents?.identity.did ?? null
  }

  /**
   * Sign arbitrary bytes with the vault's ed25519 identity key.
   * Returns a 64-byte detached signature. The private key never leaves the
   * main process. Used by the Attestto self-attested PDF signer.
   */
  sign(message: Uint8Array): Uint8Array {
    if (!this.isUnlocked || !this.contents) throw new Error('Vault is locked')
    const secretKey = new Uint8Array(
      Buffer.from(this.contents.identity.privateKeyHex, 'hex'),
    )
    const sig = nacl.sign.detached(message, secretKey)
    this.touch()
    return sig
  }

  // ── Inner encryption (artifacts inside the already-encrypted vault) ──
  // Defense against memory dumps and serialization mishaps. Each artifact
  // gets a unique key derived from the vault key via HKDF-SHA-256 with a
  // per-artifact random salt. xsalsa20-poly1305 (nacl.secretbox) provides
  // authenticated encryption.

  /** Derive an inner key for one artifact from the unlocked vault key. */
  private deriveArtifactKey(salt: Uint8Array, info: string): Uint8Array {
    if (!this.vaultKey) throw new Error('Vault is locked')
    const ikm = this.vaultKey
    const out = hkdfSync('sha256', ikm, salt, Buffer.from(info, 'utf-8'), 32)
    return new Uint8Array(out as ArrayBuffer)
  }

  /**
   * Encrypt raw artifact bytes for storage in a VerificationSession.
   * Caller hashes the plaintext separately (SHA-256 hex) — that hash is
   * what gets referenced from the IdentityVC. The hash is NOT computed here
   * because the renderer already has the bytes via Web Crypto.
   */
  encryptArtifact(plaintext: Uint8Array, mediaType: string, hashHex: string, info: string): EncryptedArtifact {
    if (!this.isUnlocked || !this.vaultKey) throw new Error('Vault is locked')
    const salt = randomBytes(16)
    const key = this.deriveArtifactKey(new Uint8Array(salt), info)
    const nonce = randomBytes(24)
    const ciphertext = nacl.secretbox(plaintext, new Uint8Array(nonce), key)
    // Wipe derived key from memory ASAP
    key.fill(0)
    return {
      hash: hashHex,
      ciphertext: Buffer.from(ciphertext).toString('base64'),
      nonce: Buffer.from(nonce).toString('base64'),
      saltHex: salt.toString('hex'),
      mediaType,
      byteLength: plaintext.byteLength,
    }
  }

  /** Decrypt an artifact for auditor inspection. Throws on tamper. */
  decryptArtifact(artifact: EncryptedArtifact, info: string): Uint8Array {
    if (!this.isUnlocked || !this.vaultKey) throw new Error('Vault is locked')
    const salt = new Uint8Array(Buffer.from(artifact.saltHex, 'hex'))
    const key = this.deriveArtifactKey(salt, info)
    const nonce = new Uint8Array(Buffer.from(artifact.nonce, 'base64'))
    const ciphertext = new Uint8Array(Buffer.from(artifact.ciphertext, 'base64'))
    const plaintext = nacl.secretbox.open(ciphertext, nonce, key)
    key.fill(0)
    if (!plaintext) throw new Error('Artifact decryption failed — vault tampering?')
    if (plaintext.byteLength !== artifact.byteLength) {
      throw new Error('Artifact size mismatch — corrupted')
    }
    return plaintext
  }

  /** Get the encrypted vault envelope bytes for Shamir splitting */
  getEncryptedBytes(): Uint8Array | null {
    if (!this.exists()) return null
    try {
      return readFileSync(this.envelopePath)
    } catch {
      return null
    }
  }

  /** Restore vault from encrypted envelope bytes + passphrase for recovery */
  restoreFromBytes(envelopeBytes: Uint8Array, passphrase: string): boolean {
    // Recovery still uses a passphrase as the user may not have their device's keychain
    try {
      const envelope: VaultEnvelope = JSON.parse(new TextDecoder().decode(envelopeBytes))
      // For recovery, the passphrase is used to derive a key
      const { scryptSync } = require('node:crypto')
      const salt = Buffer.from(envelope.kdfParams?.saltHex ?? '00', 'hex')
      const key = new Uint8Array(scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 }))
      const nonce = Buffer.from(envelope.nonce, 'hex')
      const ciphertext = Buffer.from(envelope.ciphertext, 'hex')

      const plaintext = nacl.secretbox.open(
        new Uint8Array(ciphertext),
        new Uint8Array(nonce),
        key,
      )

      if (!plaintext) return false

      // Store the key in OS keychain for future unlocks
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS keychain (safeStorage) is not available — cannot store recovered key securely')
      }
      const encrypted = safeStorage.encryptString(Buffer.from(key).toString('hex'))
      writeFileSync(this.keyPath, encrypted)

      writeFileSync(this.envelopePath, JSON.stringify(envelope, null, 2))

      this.vaultKey = key
      this.contents = JSON.parse(new TextDecoder().decode(plaintext))
      this.touch()
      this.startAutoLock()
      return true
    } catch {
      return false
    }
  }

  onLock(listener: () => void): () => void {
    this.lockListeners.push(listener)
    return () => {
      this.lockListeners = this.lockListeners.filter((l) => l !== listener)
    }
  }

  // ── Private ──────────────────────────────────────

  private writeToDisk(): void {
    if (!this.contents || !this.vaultKey) return

    const plaintext = new TextEncoder().encode(JSON.stringify(this.contents))
    const nonce = randomBytes(24)

    const ciphertext = nacl.secretbox(
      new Uint8Array(plaintext),
      new Uint8Array(nonce),
      this.vaultKey,
    )

    const envelope: VaultEnvelope = {
      formatVersion: 1,
      cryptoSuite: CRYPTO_SUITE,
      kdfAlgorithm: 'scrypt',
      kdfParams: { N: 16384, r: 8, p: 1, saltHex: randomBytes(16).toString('hex') },
      nonce: Buffer.from(nonce).toString('hex'),
      ciphertext: Buffer.from(ciphertext).toString('hex'),
    }

    writeFileSync(this.envelopePath, JSON.stringify(envelope, null, 2))
  }

  private publicKeyToDid(publicKey: Uint8Array): string {
    const multicodec = new Uint8Array([0xed, 0x01, ...publicKey])
    const encoded = Buffer.from(multicodec).toString('base64url')
    return `did:key:z${encoded}`
  }

  private touch(): void {
    this.lastAccessAt = Date.now()
  }

  private startAutoLock(): void {
    this.stopAutoLock()
    this.autoLockTimer = setInterval(() => {
      if (Date.now() - this.lastAccessAt > AUTO_LOCK_MS) {
        this.lock()
      }
    }, 60_000)
  }

  private stopAutoLock(): void {
    if (this.autoLockTimer) {
      clearInterval(this.autoLockTimer)
      this.autoLockTimer = null
    }
  }
}

/** Singleton */
export const vaultService = new VaultService()
