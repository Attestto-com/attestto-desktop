# attestto-desktop — Operating Rules

> Sovereign identity desktop station — Electron app with P2P mesh, offline verification, and credential vault.

## Stack

- Electron 39 + Vue 3 + Quasar + Vite (via `electron-vite`)
- TypeScript
- Crypto: Ed25519 (vault signing), xsalsa20-poly1305 + scrypt (vault encryption)
- Biometrics: TensorFlow.js + @vladmandic/face-api + @mediapipe/tasks-vision
- OCR: tesseract.js 7 (MRZ extraction)
- PDF: @attestto/verify (PAdES verification), @signpdf/signpdf (PAdES signing)
- Mesh: @attestto/mesh (libp2p P2P), WebSocket
- Trust: @attestto/trust (CR X.509 trust anchors)
- VC SDKs: @attestto/vc-sdk, @attestto/cr-vc-sdk (credential issuance + verification)
- DB: better-sqlite3 (local vault)
- Recovery: shamir-secret-sharing (2-of-3 guardian recovery)

## Commands

- `pnpm install` -- install deps
- `pnpm build` -- build for production
- `pnpm type-check` -- type-check without emitting
- `pnpm pack` -- package for distribution
- `pnpm dist:mac` / `dist:win` / `dist:linux` -- build platform distributables

## Architecture

### Process split
- **Main process** (`src/main/`): vault (encrypted storage), capture server (local HTTPS for phone camera), exam proctoring, mesh P2P, PKI/Firma Digital validation, PDF signing, module system, auto-updater
- **Renderer** (`src/renderer/`): Vue 3 + Quasar UI with views, composables, stores
- **Preload** (`src/preload/`): IPC bridge (`presenciaAPI`) — renderer talks to main via typed channels
- **Shared** (`src/shared/`): Type definitions for IPC contracts (`vault-api.d.ts`, `firma-api.d.ts`, `mesh-api.d.ts`)

### Credential flow
- Credentials are W3C VCs stored in the encrypted vault (`VaultCredential` type)
- Vault supports both legacy flat shape (`data: {}`) and W3C shape (`@context`, `credentialSubject`, `evidence`, `proof`)
- Signing uses Ed25519 pairwise sub-keys with delegation proofs (via main-process IPC)
- `@attestto/cr-vc-sdk` provides canonical types; some views still use inline construction (migration in progress)

### Views (17)
CedulaVerification, Credentials, DimexVerification, Exam, ExploreModules, GuardianSetup, Identity, NotaryDemo, Onboarding, Pdf, Recovery, Sector, Session, Settings, Signing, VaultUnlock, Audit

## Rules

- This is a public repo (Apache 2.0) — no PII, no private keys, no internal references in code
- Do not add CORTEX-specific rules here
- Do not run `pnpm dev` or `electron-vite dev` — user owns the dev server
- Privacy is paramount: biometrics double-encrypted in vault, camera frames never leave device, mesh data encrypted in transit
- The `@attestto/verify` package is linked locally — if types break, add a `declare module` shim in `src/env.d.ts`
- MRZ OCR code lives in `src/renderer/country/cr/mrz-ocr.ts` — this is the canonical OCR implementation for Costa Rica documents
- Vault cipher is xsalsa20-poly1305 (NaCl secretbox) — never claim AES on any marketing surface

### did:sns format rules (CI-enforced, spec §7.1)

Per the did:sns spec ABNF, the `.sol` TLD is **never** included in the DID — the resolver appends it during on-chain lookup. Max **2 levels** (1 dot):

```
✅ did:sns:fi-cr                  — root TLD
✅ did:sns:tse.go-cr              — subdomain under go-cr
✅ did:sns:station-abc.attestto   — station under attestto
✅ did:sns:vault.attestto         — vault under attestto

❌ did:sns:fi-cr.sol              — .sol is redundant (resolver adds it)
❌ did:sns:padron.tse.go-cr       — 3 levels (2 dots)
❌ did:sns:sinpe.fi.cr            — not an SNS domain format
```

**Rules**:
1. Never include `.sol` — the method `sns` already implies Solana
2. Max 1 dot (2 levels): `sub.domain`, never `a.b.c`
3. Use dashes to flatten: `padron-tse.go-cr` NOT `padron.tse.go-cr`

CI guardrail in `build.yml` rejects both `.sol` suffix and 3+ level depth.

### Firma Digital architecture

Two paths, one validator:

**Verify path (WORKING):** User signs externally (physical card OR cloud/phone — any BCCR-issued cert) → PKCS#7 arrives → `firma-validator.ts` validates cert chain against BCCR trust roots from `@attestto/trust`. No API integration needed. Attestto just verifies what the user already signed.

**Sign path (FUTURE, PKCS#11):** User inserts physical smart card → desktop signs directly via `pkcs11js`. Requires ATT-340/377/379/380/385. Not yet implemented.

Key files:
- `src/main/pki/firma-validator.ts` — PKCS#7 parser + cert chain validation
- `src/main/pki/firma-ipc.ts` — `firma:validate-pkcs7` IPC channel
- Trust roots from `@attestto/trust` (`countries/cr/current/*.pem`)
