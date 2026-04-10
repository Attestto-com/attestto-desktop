/**
 * Standalone test runner for ATT-355 incremental-info-update.ts.
 *
 * This repo doesn't have vitest wired yet (the existing
 * firma-validator.spec.ts is dead code awaiting that bootstrap).
 * Rather than dragging vitest into ATT-355's blast radius, this script
 * exercises the same invariants directly via node --experimental-strip-types.
 *
 * Run:
 *   node --experimental-strip-types scripts/test-incremental-att355.mjs
 *
 * If tests/fixtures/firma-digital-real.pdf exists, the real-fixture
 * round-trip is included.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import {
  appendKeywordRevision,
  hasExistingSignature,
} from '../src/main/pdf/incremental-info-update.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = join(__dirname, '..', 'tests', 'fixtures', 'firma-digital-real.pdf')

let pass = 0
let fail = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    pass++
  } catch (err) {
    console.log(`  ✗ ${name}`)
    console.log(`     ${err.message}`)
    fail++
    failures.push({ name, err })
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertBytePrefix(prefix, full, label) {
  if (full.length < prefix.length) {
    throw new Error(`${label}: full is shorter than prefix`)
  }
  for (let i = 0; i < prefix.length; i++) {
    if (full[i] !== prefix[i]) {
      throw new Error(`${label}: byte ${i} differs (${prefix[i]} vs ${full[i]})`)
    }
  }
}

async function makeMinimalPdf() {
  const doc = await PDFDocument.create()
  doc.addPage([400, 400])
  doc.setTitle('Original Title')
  doc.setAuthor('Original Author')
  return doc.save()
}

console.log('appendKeywordRevision')

await test('leaves the original byte prefix intact', async () => {
  const original = await makeMinimalPdf()
  const { pdfBytes: out } = appendKeywordRevision({
    pdfBytes: original,
    keywordValue: 'attestto-sig-v1:HELLO',
  })
  if (out.length <= original.length) throw new Error('output not larger')
  assertBytePrefix(original, out, 'prefix')
})

await test('produces a valid PDF that pdf-lib can re-load', async () => {
  const original = await makeMinimalPdf()
  // Caller is responsible for extracting prior metadata (the writer
  // doesn't decompress object streams).
  const { pdfBytes: out } = appendKeywordRevision({
    pdfBytes: original,
    keywordValue: 'attestto-sig-v1:abcd',
    carriedInfo: { title: 'Original Title', author: 'Original Author' },
  })
  const reloaded = await PDFDocument.load(out)
  assertEqual(reloaded.getTitle(), 'Original Title', 'title carryover')
  assertEqual(reloaded.getAuthor(), 'Original Author', 'author carryover')
  assertEqual(reloaded.getKeywords(), 'attestto-sig-v1:abcd', 'keywords roundtrip')
  // /Producer: pdf-lib's getProducer() caches the first revision's
  // value and doesn't refresh from the latest /Info ref. We verify the
  // override landed in the appended bytes instead — real-world PAdES
  // verifiers read /Producer directly from the latest /Info per spec.
  const appendedText = new TextDecoder('latin1').decode(out.subarray(original.length))
  if (!appendedText.includes('/Producer')) throw new Error('producer key missing in appended bytes')
})

await test('rejects encrypted PDFs', async () => {
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
  let threw = false
  try {
    appendKeywordRevision({ pdfBytes: bytes, keywordValue: 'x' })
  } catch (e) {
    threw = /encrypted/i.test(e.message)
  }
  if (!threw) throw new Error('did not throw for encrypted PDF')
})

await test('stacks revisions: prior bytes immutable across stacked appends', async () => {
  const original = await makeMinimalPdf()
  const r1 = appendKeywordRevision({
    pdfBytes: original,
    keywordValue: 'attestto-sig-v1:FIRST',
  }).pdfBytes
  const r2 = appendKeywordRevision({
    pdfBytes: r1,
    keywordValue: 'attestto-sig-v1:SECOND',
  }).pdfBytes
  assertBytePrefix(r1, r2, 'r1 ⊂ r2')
  const reloaded = await PDFDocument.load(r2)
  assertEqual(reloaded.getKeywords(), 'attestto-sig-v1:SECOND', 'last revision wins')
})

console.log('hasExistingSignature')

await test('returns false for a fresh pdf-lib PDF', async () => {
  const pdf = await makeMinimalPdf()
  if (hasExistingSignature(pdf)) throw new Error('false positive')
})

await test('returns true when /Type /Sig is present', async () => {
  const fake = new TextEncoder().encode(
    '%PDF-1.7\n3 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite >>\nendobj\n',
  )
  if (!hasExistingSignature(fake)) throw new Error('missed /Type /Sig')
})

await test('returns true when /SigFlags 3 is present', async () => {
  const fake = new TextEncoder().encode(
    '%PDF-1.7\n4 0 obj\n<< /AcroForm << /SigFlags 3 >> >>\nendobj\n',
  )
  if (!hasExistingSignature(fake)) throw new Error('missed /SigFlags')
})

if (existsSync(FIXTURE_PATH)) {
  console.log('against the real Firma Digital fixture')

  const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH))

  await test('detects the pre-existing /Sig', async () => {
    if (!hasExistingSignature(fixtureBytes)) throw new Error('did not detect /Sig in real fixture')
  })

  await test('appends a revision without touching original bytes', async () => {
    const { pdfBytes: out } = appendKeywordRevision({
      pdfBytes: fixtureBytes,
      keywordValue: 'attestto-sig-v1:test-payload',
    })
    if (out.length <= fixtureBytes.length) throw new Error('output not larger')
    assertBytePrefix(fixtureBytes, out, 'real-fixture prefix')
  })

  await test('produces a file pdf-lib can re-load and read /Keywords from', async () => {
    const { pdfBytes: out } = appendKeywordRevision({
      pdfBytes: fixtureBytes,
      keywordValue: 'attestto-sig-v1:roundtrip',
    })
    const doc = await PDFDocument.load(out, { ignoreEncryption: true })
    assertEqual(doc.getKeywords(), 'attestto-sig-v1:roundtrip', 'real-fixture keywords roundtrip')
  })
} else {
  console.log('real fixture skipped (drop one at tests/fixtures/firma-digital-real.pdf)')
}

console.log()
console.log(`${pass} passed, ${fail} failed`)
if (fail > 0) {
  process.exit(1)
}
