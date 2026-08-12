/**
 * SOC-191 — the issuer-binding check on signed PDFs, which never checked anything.
 *
 * `checkIssuerBinding` returned:
 *
 *     did.startsWith('did:key:z') && pubkey.length === 32
 *
 * It never compared the DID to the key. So `issuerBinding` was **true for every
 * `did:key` issuer**, `valid` ANDed a constant, and the result's own reason
 * string, "issuer DID does not match embedded public key", named an outcome
 * that could not occur. A verifier reported that it had checked the issuer.
 *
 * The comment above it was honest about being permissive, and the deferral had
 * a stated cause: "rather than implementing base58 here". That is what makes
 * this the same finding as the malformed `did:key` rather than a separate one
 * — a missing encoder took out the encoder AND the control that would have
 * caught it.
 *
 * The signature check does not cover this gap. It proves the embedded key
 * signed the document; it says nothing about whether that key is the issuer the
 * document names. The test below signs with one key while naming another, and
 * the signature is genuinely valid throughout.
 */
import { describe, it, expect } from 'vitest'
import nacl from 'tweetnacl'
import { PDFDocument } from 'pdf-lib'
import { signAttesttoPdf, verifyAttesttoPdf } from '../src/main/pdf/pdf-attestto'
import { didKeyFromEd25519PublicKey } from '../src/shared/did-key'

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  return doc.save()
}

const signer = nacl.sign.keyPair()
const stranger = nacl.sign.keyPair()

const sign = async (bytes: Uint8Array) => nacl.sign.detached(bytes, signer.secretKey)

const signWith = async (issuerDid: string) =>
  (
    await signAttesttoPdf({
      pdfBytes: await blankPdf(),
      fileName: 'acta.pdf',
      signerDid: issuerDid,
      signerPublicKey: signer.publicKey,
      sign,
      level: 'self-attested',
      mode: 'final',
    })
  ).pdfBytes

describe('a signed PDF names the key that signed it', () => {
  it('verifies when the issuer DID encodes the signing key', async () => {
    const did = didKeyFromEd25519PublicKey(signer.publicKey)
    const result = await verifyAttesttoPdf(await signWith(did))

    expect(result).not.toBeNull()
    expect(result!.signatureValid).toBe(true)
    expect(result!.issuerBinding).toBe(true)
    expect(result!.valid).toBe(true)
  })

  it('refuses a document whose issuer DID is somebody else', async () => {
    // The signature here is VALID: the embedded key really did sign this
    // payload. Only the issuer is wrong. Before this fix the document verified
    // and reported `issuerBinding: true`, so a signature block could be
    // re-served under any DID and the verifier vouched for it.
    const someoneElse = didKeyFromEd25519PublicKey(stranger.publicKey)
    const result = await verifyAttesttoPdf(await signWith(someoneElse))

    expect(result).not.toBeNull()
    expect(result!.signatureValid).toBe(true)
    expect(result!.issuerBinding).toBe(false)
    expect(result!.valid).toBe(false)
    expect(result!.reason).toMatch(/issuer DID does not match/i)
  })

  it('refuses a document issued under the malformed did:key this app used to mint', async () => {
    // base64url behind a base58btc `z`. Accepting it would keep every legacy
    // identifier working and the migration would never complete.
    const legacy = `did:key:z${Buffer.from(
      Uint8Array.from([0xed, 0x01, ...signer.publicKey]),
    ).toString('base64url')}`
    const result = await verifyAttesttoPdf(await signWith(legacy))

    expect(result!.signatureValid).toBe(true)
    expect(result!.issuerBinding).toBe(false)
    expect(result!.valid).toBe(false)
  })
})
