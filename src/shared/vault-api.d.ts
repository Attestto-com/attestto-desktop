/**
 * Shared types for Vault + Guardian IPC contract.
 * Algorithm-agile design — cryptoSuite field enables post-quantum migration.
 */

// ── Vault Types ────────────────────────────────────

export interface VaultEnvelope {
  formatVersion: 1
  cryptoSuite: string         // e.g. 'xsalsa20-poly1305+ed25519'
  kdfAlgorithm: 'scrypt'
  kdfParams: { N: number; r: number; p: number; saltHex: string }
  nonce: string               // hex
  ciphertext: string          // hex
}

export interface VaultIdentity {
  did: string
  publicKeyHex: string
  privateKeyHex: string
  algorithm: string           // 'ed25519' → future: 'ed25519+ml-dsa-65'
  displayName?: string
}

export interface VaultSettings {
  solanaNetwork: 'devnet' | 'mainnet-beta'
  language: 'es' | 'en'
  cameraDeviceId?: string
  /**
   * Tier of the user's PDF signing capability.
   *  - 'self-attested': default after KYC. Vault ed25519 keypair, Nivel B.
   *  - 'firma-digital-mocked': Simulated Firma Digital upgrade (demo).
   *    Real PKCS#11 integration tracked in ATT-340. Mocked signatures
   *    MUST carry { mock: true } in metadata and never be anchored as Nivel A+.
   */
  firmaDigitalLevel?: 'self-attested' | 'firma-digital-mocked'
}

export interface VaultCredential {
  id: string
  type: string
  issuer: string
  issuanceDate: string
  data: Record<string, unknown>
}

export interface VaultGuardians {
  configured: boolean
  threshold: 2
  guardianDids: string[]
  lastBackupAt?: number
  backupVersion: number
}

export interface VaultPersona {
  type: string
  installedModules: string[]
  pinnedActions: string[]
  activityLog: Array<{ moduleId: string; action: string; timestamp: number }>
  onboardingComplete: boolean
}

// ── Biometric Proofs ─────────────────────────────

export interface BiometricCapture {
  id: string                    // e.g. "liveness-2026-04-05T14:32:00Z"
  type: 'face-mesh' | 'fingerprint' | 'iris'
  /** SHA-256 hash of meshData — referenced by LivenessProof VCs */
  hash: string
  /** Raw mesh data, encrypted even within the vault (double-encrypted) */
  meshDataEncrypted: string
  /** Encryption nonce for inner encryption layer */
  meshNonce: string
  /** Per-capture HKDF salt (hex) — required to re-derive the inner key on decrypt */
  meshSaltHex?: string
  capturedAt: number
  /** What triggered this capture */
  context: 'identity-verification' | 'document-signing' | 'exam-proctoring' | 'session-presence'
  /** Optional: links to the VC that references this capture */
  credentialId?: string
  /** Model used for capture — for reproducibility */
  model: {
    name: string              // e.g. 'tensorflow-face-mesh'
    version: string           // e.g. '1.4.0'
  }
  /** Anti-spoofing result */
  antiSpoof: {
    passed: boolean
    score: number             // 0.0–1.0 confidence
  }
}

/**
 * Audit-safe proof — contains hash but NOT raw biometric data.
 * This is what gets shared with auditors or included in VCs.
 */
export interface LivenessProof {
  captureId: string             // references BiometricCapture.id
  hash: string                  // SHA-256 of raw mesh — auditor can verify match
  capturedAt: number
  context: BiometricCapture['context']
  model: BiometricCapture['model']
  antiSpoof: BiometricCapture['antiSpoof']
  /** Device fingerprint — ties proof to a specific device */
  deviceFingerprint: string     // SHA-256 of hardware identifiers
}

/**
 * One artifact captured during a verification session, double-encrypted
 * (the outer vault is already encrypted; this is the inner layer keyed
 * per-session so a memory dump of the unlocked vault still doesn't expose
 * raw biometrics or document images).
 */
export interface EncryptedArtifact {
  /** SHA-256 hex of the plaintext bytes — what the IdentityVC references */
  hash: string
  /** Base64 of inner-encrypted bytes (xsalsa20-poly1305) */
  ciphertext: string
  /** Base64 of inner encryption nonce (24 bytes) */
  nonce: string
  /** Per-artifact salt used to derive the inner key from the vault key (hex) */
  saltHex: string
  /** MIME type of plaintext, e.g. 'image/jpeg', 'application/octet-stream' */
  mediaType: string
  /** Plaintext byte length, for sanity checks on decryption */
  byteLength: number
}

/**
 * One identity verification — groups all artifacts captured together
 * (cédula front, cédula back, selfie, face descriptor) plus the computed
 * face-match score and anti-spoof result. The IdentityVC in credentials[]
 * references this session by id.
 */
export interface VerificationSession {
  /** e.g. 'verification-2026-04-08T14:32:00.000Z' */
  id: string
  capturedAt: number
  /** Links to the IdentityVC in credentials[] (set after credential is stored) */
  credentialId?: string
  context: BiometricCapture['context']
  cedulaFront: EncryptedArtifact
  cedulaBack: EncryptedArtifact
  selfie: EncryptedArtifact
  /** 128D Float32Array (512 bytes) face descriptor from @vladmandic/face-api */
  faceDescriptor: EncryptedArtifact
  /** 0..1 — euclidean-derived similarity between cédula photo and selfie */
  faceMatchScore: number
  /** Threshold actually used to decide pass/fail */
  faceMatchThreshold: number
  antiSpoof: { passed: boolean; score: number }
  model: { name: string; version: string }
}

export interface VaultContents {
  version: 1
  createdAt: number
  updatedAt: number
  identity: VaultIdentity
  persona: VaultPersona
  settings: VaultSettings
  credentials: VaultCredential[]
  guardians: VaultGuardians
  /** Encrypted biometric captures — raw data never leaves the vault */
  biometrics: BiometricCapture[]
  /** Identity verification sessions — raw evidence (docs + face) for auditors */
  verificationSessions: VerificationSession[]
}

// ── Vault IPC ──────────────────────────────────────

export interface VaultCreateParams {
  passphrase: string
}

export interface VaultCreateResult {
  did: string
}

export interface VaultUnlockParams {
  passphrase: string
}

export interface VaultStatus {
  exists: boolean
  unlocked: boolean
  did: string | null
  lastBackupAt?: number
}

// ── Guardian IPC ───────────────────────────────────

export interface GuardianSetupParams {
  guardianDids: [string, string, string]
}

export interface GuardianBackupResult {
  success: boolean
  version: number
}

export interface GuardianRecoverParams {
  passphrase: string
  userDid: string
  guardianDids: string[]
}

// ── API Interfaces ─────────────────────────────────

export interface VaultAPI {
  create(params: VaultCreateParams): Promise<VaultCreateResult>
  unlock(params: VaultUnlockParams): Promise<boolean>
  lock(): Promise<void>
  exists(): Promise<boolean>
  read(): Promise<VaultContents | null>
  write(data: Partial<VaultContents>): Promise<void>
  status(): Promise<VaultStatus>
  /** Inner-encrypt one artifact for storage in a VerificationSession. */
  encryptArtifact(params: {
    plaintext: Uint8Array
    mediaType: string
    hashHex: string
    info: string
  }): Promise<EncryptedArtifact>
  /** Decrypt one artifact for auditor inspection. */
  decryptArtifact(params: { artifact: EncryptedArtifact; info: string }): Promise<Uint8Array>
  onLocked(callback: () => void): () => void
}

export interface GuardianAPI {
  setup(params: GuardianSetupParams): Promise<void>
  backup(): Promise<GuardianBackupResult>
  recover(params: GuardianRecoverParams): Promise<boolean>
  status(): Promise<VaultGuardians | null>
}
