# Attestto Root CA

This directory holds the **Attestto Certificate Authority root certificate(s)**
that ship bundled with attestto-desktop. Every install of the desktop app
implicitly trusts identity certificates issued by these roots.

The full trust framework lives at `docs/ca-trust-framework.md`. Read that
first.

## What goes here

- `attestto-root.cer` (or `.pem`) — the root cert for `did:sns:vault.attestto`,
  Ed25519, signed by the Squads 2-of-3 founder multisig
- (future) intermediate CA certs for `did:sns:fi-cr`, `did:sns:go-cr`, and the
  per-country `fi-XX` CAs as they come online

The validator (`src/main/pki/firma-validator.ts`) loads every `.cer`/`.crt`/
`.pem`/`.der` file in this directory at startup and tags each anchor with
origin `attestto`. A signature whose chain anchors here is shown in the UI as
"Attestto-issued" — distinct from "CR Firma Digital" (BCCR-anchored) but
equally trusted.

## Generation protocol

The root keypair is generated **offline, air-gapped, on a hardware token**.
This is a user task, never a Claude task. See `docs/ca-key-governance.md` and
`docs/ca-ceremony-module.md` for the procedure.

Until the real root is generated, this directory is empty and the validator
runs in BCCR-only mode — Attestto-issued certs will fall back to
`untrusted-root` until the real root cert lands here.

## Do NOT commit private keys

Only public root certificates belong here. The Ed25519 private key for
`did:sns:vault.attestto` lives behind the Squads multisig and never touches a
file system at rest.
