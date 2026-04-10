/**
 * Incremental PDF revision writer — automated test (ATT-355).
 *
 * The hard guarantee we need to verify: bytes [0..originalLength) MUST
 * be byte-identical between input and output. That is the property that
 * lets a pre-existing PAdES /ByteRange digest still validate after we
 * append our Attestto countersignature revision.
 *
 * If a real Firma Digital fixture is present at
 * `tests/fixtures/firma-digital-real.pdf`, we run the same test against
 * it. Otherwise we synthesise a minimal PDF in-memory via pdf-lib.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import {
  appendKeywordRevision,
  hasExistingSignature,
} from '../src/main/pdf/incremental-info-update'

const FIXTURE_PATH = join(__dirname, 'fixtures', 'firma-digital-real.pdf')

async function makeMinimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([400, 400])
  doc.setTitle('Original Title')
  doc.setAuthor('Original Author')
  return doc.save()
}

describe('appendKeywordRevision', () => {
  it('leaves the original byte prefix intact', async () => {
    const original = await makeMinimalPdf()
    const { pdfBytes: out } = appendKeywordRevision({
      pdfBytes: original,
      keywordValue: 'attestto-sig-v1:HELLO',
    })

    expect(out.length).toBeGreaterThan(original.length)
    // Byte-for-byte identity for the prefix is the load-bearing claim.
    for (let i = 0; i < original.length; i++) {
      if (out[i] !== original[i]) {
        throw new Error(`byte ${i} differs: original=${original[i]} out=${out[i]}`)
      }
    }
  })

  it('produces a valid PDF that pdf-lib can re-load', async () => {
    const original = await makeMinimalPdf()
    const { pdfBytes: out } = appendKeywordRevision({
      pdfBytes: original,
      keywordValue: 'attestto-sig-v1:abcd',
      carriedInfo: { title: 'Original Title', author: 'Original Author' },
    })

    const reloaded = await PDFDocument.load(out)
    // Title should survive (carried over from prior /Info).
    expect(reloaded.getTitle()).toBe('Original Title')
    expect(reloaded.getAuthor()).toBe('Original Author')
    // The incremental update writes strings as UTF-16BE hex. Verify
    // the raw output contains /Producer and /Keywords entries.
    const outStr = new TextDecoder('latin1').decode(out)
    expect(outStr).toContain('/Producer')
    expect(outStr).toContain('/Keywords')
  })

  it('rejects encrypted PDFs', async () => {
    // Synthesize a minimal "trailer with /Encrypt" tail by hand. The
    // appendKeywordRevision parser only inspects the trailer dict, so a
    // hand-rolled minimal file is enough to trigger the encrypted-path
    // refusal without needing a real encrypted fixture.
    const fake =
      '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n' +
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
      '2 0 obj << /Type /Pages /Count 0 /Kids [] >> endobj\n' +
      'xref\n0 3\n' +
      '0000000000 65535 f \n' +
      '0000000015 00000 n \n' +
      '0000000063 00000 n \n' +
      'trailer\n<< /Size 3 /Root 1 0 R /Encrypt 9 0 R >>\n' +
      'startxref\n110\n%%EOF\n'
    const bytes = new TextEncoder().encode(fake)
    expect(() =>
      appendKeywordRevision({ pdfBytes: bytes, keywordValue: 'x' }),
    ).toThrow(/encrypted/i)
  })

  it('overwrites a prior Attestto keyword on round-trip (last revision wins)', async () => {
    const original = await makeMinimalPdf()
    const r1 = appendKeywordRevision({
      pdfBytes: original,
      keywordValue: 'attestto-sig-v1:FIRST',
    }).pdfBytes
    const r2 = appendKeywordRevision({
      pdfBytes: r1,
      keywordValue: 'attestto-sig-v1:SECOND',
    }).pdfBytes

    // r1 must still be a prefix of r2 — that is the whole point of
    // incremental updates: revisions stack, prior bytes are immutable.
    for (let i = 0; i < r1.length; i++) {
      if (r2[i] !== r1[i]) {
        throw new Error(`incremental stack broken at byte ${i}`)
      }
    }
    const reloaded = await PDFDocument.load(r2)
    expect(reloaded.getKeywords()).toBe('attestto-sig-v1:SECOND')
  })
})

describe('hasExistingSignature', () => {
  it('returns false for a fresh pdf-lib PDF', async () => {
    const pdf = await makeMinimalPdf()
    expect(hasExistingSignature(pdf)).toBe(false)
  })

  it('returns true when /Type /Sig is present', () => {
    const fake = new TextEncoder().encode(
      '%PDF-1.7\n3 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite >>\nendobj\n',
    )
    expect(hasExistingSignature(fake)).toBe(true)
  })

  it('returns true when /SigFlags 3 is present', () => {
    const fake = new TextEncoder().encode(
      '%PDF-1.7\n4 0 obj\n<< /AcroForm << /SigFlags 3 >> >>\nendobj\n',
    )
    expect(hasExistingSignature(fake)).toBe(true)
  })
})

// ── Real fixture (Guillermo's expired Firma Digital PDF) ────────────
//
// This block is the load-bearing test for ATT-355. It only runs when
// `tests/fixtures/firma-digital-real.pdf` exists on disk. The fixture
// is .gitignored — drop the file in locally, run the test, ship.
const hasFixture = existsSync(FIXTURE_PATH)
const describeFixture = hasFixture ? describe : describe.skip

describeFixture('against the real Firma Digital fixture', () => {
  it('detects the pre-existing /Sig', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE_PATH))
    expect(hasExistingSignature(bytes)).toBe(true)
  })

  it('appends a revision without touching original bytes', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE_PATH))
    const { pdfBytes: out } = appendKeywordRevision({
      pdfBytes: bytes,
      keywordValue: 'attestto-sig-v1:test-payload',
    })
    expect(out.length).toBeGreaterThan(bytes.length)
    for (let i = 0; i < bytes.length; i++) {
      if (out[i] !== bytes[i]) {
        throw new Error(`real-fixture byte ${i} differs`)
      }
    }
  })

  it('produces a file pdf-lib can re-load and read /Keywords from', async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE_PATH))
    const { pdfBytes: out } = appendKeywordRevision({
      pdfBytes: bytes,
      keywordValue: 'attestto-sig-v1:roundtrip',
    })
    const doc = await PDFDocument.load(out, { ignoreEncryption: true })
    expect(doc.getKeywords()).toBe('attestto-sig-v1:roundtrip')
  })
})
