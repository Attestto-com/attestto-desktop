# Test fixtures

## `firma-digital-real.pdf` (NOT committed)

The Firma Digital validator test (`tests/firma-validator.spec.ts`) needs at
least one **real** Costa Rica Firma Digital signed PDF to validate against.
Drop one here as `firma-digital-real.pdf` and the test will pick it up.

Good sources:
- Any PDF you have personally signed with your Firma Digital smartcard
- A document downloaded from `tramites.go.cr` that has been signed by a
  CR civil servant or notary
- A `Hacienda` or `Ministerio` issued PDF that bears a Firma Digital seal

**Do NOT commit this file.** It contains a real signature with personal data.
The fixture path is added to `.gitignore`.

## What the test asserts on it

Phase 1 (chain only — current scaffold):
- The PDF contains a PKCS#7 dictionary
- The cert chain anchors to a bundled BCCR root in `src/main/pki/bccr-roots/`
- The root subject CN matches the CR national root pattern

Phase 2 (uncomment in the spec once OCSP wiring lands):
- OCSP responder reports `good` for the signer cert
- `trusted: true`
