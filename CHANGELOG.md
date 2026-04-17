# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **[ATT-267]** IPC sender frame validation — all vault and guardian handlers now verify `senderFrame.url` origin before processing. Prevents rogue frames from accessing vault, signing, or guardian APIs.
- **[ATT-268]** Enable Electron renderer sandbox (`sandbox: true`). Preload uses `contextBridge` so camera and all IPC work unchanged.
- **[ATT-269]** Remove safeStorage plaintext fallback — vault creation, unlock, and recovery now throw if OS keychain is unavailable instead of silently writing keys in plaintext to disk.
- **[ATT-270]** Module integrity verification — downloaded module payloads are SHA-256 checked against registry integrity hash before install. Prevents supply-chain substitution.
- **[ATT-271]** Guardian shard signature verification on recovery — shards fetched from mesh are ed25519-verified before Shamir combine to prevent recovery poisoning.
- **[ATT-274]** Increase scrypt N from 16384 to 65536 for passphrase-derived keys (OWASP 2024+ recommendation). Existing vaults unaffected — N is read from stored envelope.
- **[ATT-337]** Guardian recovery shard signing — shards are now signed with real ed25519 key (was empty string).

### Added
- **[ATT-280]** Vault auto-lock on system sleep and screen lock via `powerMonitor`.
- **[ATT-362]** Desktop release CI — matrix build for .dmg / .exe / .AppImage via GitHub Actions.
- **[ATT-307]** Desktop ID verification flow — webcam face capture with liveness detection.
- **[ATT-346]** W3C VC shape rendering in CredentialsPage with trust badges and labels.

## [0.1.0] - 2026-04-10

### Added
- Initial release
- Encrypted vault with Ed25519 identity and xsalsa20-poly1305 + scrypt
- Touch ID / OS keychain unlock
- Guardian social recovery (Shamir 2-of-3)
- P2P mesh via @attestto/mesh (libp2p)
- Country module system with runtime loading
- CR cédula and DIMEX verification flows
- PDF signing and verification (PAdES)
- Firma Digital PKCS#7 validation against BCCR trust roots
- Exam proctoring with face detection
- Station identity with pairwise delegation proofs
- Desktop builds for macOS, Windows, Linux
