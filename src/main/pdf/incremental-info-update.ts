/**
 * Incremental PDF revision writer — ATT-355.
 *
 * Why this exists:
 *   pdf-lib's `PDFDocument.save()` does a FULL rewrite of the file:
 *   it re-emits every object, recomputes the xref, and writes a fresh
 *   trailer. That is fine for a virgin PDF but it CATASTROPHICALLY breaks
 *   any pre-existing PAdES (`/Type /Sig`) signature, because the
 *   signature's `/ByteRange` was computed against the original byte
 *   layout. After a full rewrite, those byte offsets point at different
 *   content, so the signed digest no longer matches and every PAdES
 *   verifier (Adobe Reader, our own firma-validator, etc.) flags the
 *   document as TAMPERED.
 *
 *   Real-world failure: a user signs a PDF with an external Firma
 *   Digital tool (BCCR card, Adobe, JSignPdf, …) and then opens it in
 *   Attestto Desktop to add an Attestto self-attested co-signature. The
 *   Attestto save destroys the BCCR signature without warning.
 *
 * What this module does:
 *   Append an INCREMENTAL UPDATE — a new PDF revision tacked on to the
 *   end of the original byte buffer. Bytes [0..originalLength) are
 *   left BYTE-IDENTICAL, so any prior /ByteRange digests still validate.
 *   The new revision contains:
 *     - a fresh /Info dict object (new object number) carrying our
 *       Attestto keyword payload (and best-effort copies of the old
 *       /Title, /Author, /Subject, /Producer, /Creator if we can find
 *       the previous /Info object)
 *     - a classic xref subsection with that one new object
 *     - a trailer with /Prev pointing at the previous xref (so readers
 *       walk the revision chain) and /Root carried over
 *     - startxref + %%EOF
 *
 *   Classic-xref subsections are accepted by all conforming PDF 1.5+
 *   readers even when the previous revision used a cross-reference
 *   stream (ISO 32000-1 §7.5.6, "hybrid-reference files"). We use a
 *   classic table because emitting a valid xref STREAM (Predictor 12,
 *   PNG filter, packed binary entries) is far more code and error-prone
 *   than necessary for a one-object update.
 *
 * Scope (this commit, ATT-355 part 1):
 *   - Updates ONLY the /Info dict to embed our keyword.
 *   - Does NOT draw a visible stamp on top of the page. Drawing into a
 *     page in incremental mode requires appending a new content stream
 *     and a new page object — feasible, but ~3× the code and out of
 *     scope for the hot fix that unblocks the lawyer pilot. The caller
 *     (`pdf-attestto.ts`) only takes this path when it detects a
 *     pre-existing /Sig and explicitly suppresses the stamp; the
 *     virgin-PDF path keeps the stamp via the existing pdf-lib flow.
 *   - Does NOT support encrypted PDFs. We detect /Encrypt in the trailer
 *     and refuse — encrypted Firma Digital PDFs would need decrypt/
 *     re-encrypt with the original key, which is out of scope.
 *
 * Alternative considered (documented for ATT-355 part 2):
 *   `muhammara` (formerly Hummus) is a battle-tested C++ PDF lib with
 *   N-API bindings that handles incremental updates including content-
 *   stream injection and visible-stamp drawing. We chose pure-JS
 *   `@signpdf/signpdf` + this hand-rolled writer for v1 to keep the
 *   Electron installer free of native rebuild steps. If the visible-
 *   stamp-on-signed-PDF feature lands, revisit muhammara.
 */

const TEXT_DECODER = new TextDecoder('latin1')
const TEXT_ENCODER = new TextEncoder()

/**
 * Result of parsing the previous revision's trailer/xref enough to
 * write a valid incremental update. Best-effort: fields the writer can
 * tolerate as missing are typed as optional.
 */
interface PriorRevisionInfo {
  /** Byte offset of the previous startxref (goes into our /Prev). */
  prevStartxref: number
  /** /Size N from the previous trailer. New objects start at N. */
  prevSize: number
  /** /Root R reference, mandatory in any trailer. */
  rootRef: string
  /** /Info R reference, optional — may be absent in minimal PDFs. */
  infoRef?: { obj: number; gen: number }
  /** Whether the previous trailer/xref dict declared /Encrypt. */
  encrypted: boolean
}

/** Read the last `n` bytes of the buffer as a latin1 string. */
function tailString(bytes: Uint8Array, n: number): string {
  const start = Math.max(0, bytes.length - n)
  return TEXT_DECODER.decode(bytes.subarray(start))
}

/**
 * Find the byte offset of the previous startxref. Per ISO 32000-1
 * §7.5.5, the last `startxref <offset>` in the file points at the most
 * recent xref. We scan the trailing 4KB which is more than sufficient
 * for any conformant PDF.
 */
function findPrevStartxref(bytes: Uint8Array): number {
  const tail = tailString(bytes, 4096)
  const match = tail.match(/startxref\s+(\d+)\s+%%EOF\s*$/)
  if (!match) {
    throw new Error('ATT-355: could not locate trailing startxref/%%EOF — file may be truncated or non-conformant')
  }
  return parseInt(match[1], 10)
}

/**
 * Read the trailer dictionary for the prior revision. Handles both:
 *   (a) classic xref tables: scan for the `trailer` keyword after the
 *       xref subsections and parse the `<< … >>` that follows.
 *   (b) cross-reference streams (PDF 1.5+): the xref stream object's
 *       own dict IS the trailer. We find `obj <<` at startxref and
 *       parse the dict portion before the `stream` keyword.
 *
 * We never decompress the stream contents — we only need /Size, /Root,
 * /Info, /Encrypt, and /Prev, all of which live in the dict header.
 */
function readTrailerDict(bytes: Uint8Array, startxrefOffset: number): { dict: string; size: number } {
  // Decode a generous window starting at the xref. Most trailers are
  // < 8KB; pad to 64KB to cover xref subsections + trailer dict.
  const window = TEXT_DECODER.decode(bytes.subarray(startxrefOffset, Math.min(bytes.length, startxrefOffset + 65536)))

  if (window.startsWith('xref')) {
    // Classic xref: skip past entries, locate `trailer` keyword.
    const trailerIdx = window.indexOf('trailer')
    if (trailerIdx < 0) {
      throw new Error('ATT-355: classic xref without trailer keyword')
    }
    const dict = extractTopLevelDict(window, trailerIdx + 'trailer'.length)
    return { dict, size: window.length }
  }

  // Cross-reference stream: starts with `<num> <gen> obj` then `<< … >>`.
  // We don't care about the obj header — just find the first `<<`.
  const dictStart = window.indexOf('<<')
  if (dictStart < 0) {
    throw new Error('ATT-355: xref stream without dict')
  }
  const dict = extractTopLevelDict(window, dictStart)
  return { dict, size: window.length }
}

/**
 * Extract a balanced `<< … >>` dict starting at-or-after `from`.
 * Tracks nesting so nested dicts and arrays don't fool us. Returns the
 * dict contents WITHOUT the surrounding `<< >>`.
 */
function extractTopLevelDict(text: string, from: number): string {
  const open = text.indexOf('<<', from)
  if (open < 0) throw new Error('ATT-355: dict open marker not found')
  let depth = 0
  let i = open
  while (i < text.length - 1) {
    const two = text.substr(i, 2)
    if (two === '<<') {
      depth++
      i += 2
      continue
    }
    if (two === '>>') {
      depth--
      if (depth === 0) {
        return text.slice(open + 2, i)
      }
      i += 2
      continue
    }
    i++
  }
  throw new Error('ATT-355: unbalanced dict in trailer')
}

/**
 * Pull the fields we need out of a trailer dict body. The dict body
 * here is the inside of `<< … >>` — flat key/value pairs except for
 * inline arrays and refs.
 */
function parseTrailerFields(dictBody: string, prevStartxref: number): PriorRevisionInfo {
  const sizeMatch = dictBody.match(/\/Size\s+(\d+)/)
  if (!sizeMatch) {
    throw new Error('ATT-355: trailer missing /Size')
  }
  const rootMatch = dictBody.match(/\/Root\s+(\d+\s+\d+\s+R)/)
  if (!rootMatch) {
    throw new Error('ATT-355: trailer missing /Root')
  }
  const infoMatch = dictBody.match(/\/Info\s+(\d+)\s+(\d+)\s+R/)
  const encrypted = /\/Encrypt\b/.test(dictBody)

  return {
    prevStartxref,
    prevSize: parseInt(sizeMatch[1], 10),
    rootRef: rootMatch[1],
    infoRef: infoMatch ? { obj: parseInt(infoMatch[1], 10), gen: parseInt(infoMatch[2], 10) } : undefined,
    encrypted,
  }
}

/**
 * Escape a UTF-8 string for embedding as a PDF literal string. We use
 * the PDF "UTF-16BE with BOM" form for full Unicode support — the BCCR
 * Firma Digital toolchain produces these too, so it round-trips well.
 */
function pdfUnicodeString(s: string): string {
  const bytes: number[] = [0xfe, 0xff] // UTF-16BE BOM
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code <= 0xffff) {
      bytes.push((code >> 8) & 0xff, code & 0xff)
    } else {
      // Surrogate pair
      const offset = code - 0x10000
      const high = 0xd800 + (offset >> 10)
      const low = 0xdc00 + (offset & 0x3ff)
      bytes.push((high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff)
    }
  }
  // Hex string form is safest — no parens to escape.
  let hex = '<'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  hex += '>'
  return hex
}

/** PDF date string per ISO 32000-1 §7.9.4: D:YYYYMMDDHHmmSS+00'00' */
function pdfDateString(d: Date): string {
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0')
  return `(D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}+00'00')`
}

export interface AppendKeywordRevisionOptions {
  /** Original PDF bytes — left untouched in output [0..N). */
  pdfBytes: Uint8Array
  /**
   * Keyword payload to embed. Stored as the /Keywords entry of the new
   * /Info dict (UTF-16BE hex string). The caller is responsible for the
   * `attestto-sig-v1:` prefix and base64 encoding of the JSON-LD.
   */
  keywordValue: string
  /** Producer string for the new /Info dict. Defaults to "Attestto Desktop Station". */
  producer?: string
  /**
   * Prior /Info string fields to carry over into the new /Info dict.
   * Caller-supplied (typically read via pdf-lib's
   * `getTitle/getAuthor/getSubject/getCreator`) so this writer doesn't
   * need to decompress object streams. Plain JS strings — we encode
   * them as UTF-16BE hex strings on the way out.
   */
  carriedInfo?: {
    title?: string
    author?: string
    subject?: string
    creator?: string
  }
}

export interface AppendKeywordRevisionResult {
  /** Original bytes + appended revision. */
  pdfBytes: Uint8Array
  /** Object number assigned to the new /Info dict. */
  newInfoObj: number
  /** Byte offset of the new startxref (= start of appended revision's xref). */
  newStartxref: number
}

/**
 * Append an incremental revision that updates /Info to embed
 * `keywordValue`. The original bytes are left byte-identical, so any
 * pre-existing PAdES /ByteRange digests still validate.
 *
 * Throws if the source PDF is encrypted (we don't have the key) or if
 * the trailer can't be parsed.
 */
export function appendKeywordRevision(opts: AppendKeywordRevisionOptions): AppendKeywordRevisionResult {
  const { pdfBytes, keywordValue, producer = 'Attestto Desktop Station', carriedInfo = {} } = opts

  const prevStartxref = findPrevStartxref(pdfBytes)
  const { dict: trailerDict } = readTrailerDict(pdfBytes, prevStartxref)
  const prior = parseTrailerFields(trailerDict, prevStartxref)

  if (prior.encrypted) {
    throw new Error('ATT-355: encrypted PDFs are not supported by the incremental signer (need /Encrypt key handling)')
  }

  // Allocate the new /Info object number = previous /Size. The new
  // trailer's /Size becomes prevSize + 1.
  const newInfoObj = prior.prevSize
  const newSize = prior.prevSize + 1

  // Build the new /Info dict body. Caller-supplied carry-over fields
  // are encoded as UTF-16BE hex strings (safe for any Unicode). We
  // deliberately overwrite any prior /Producer, /ModDate, /Keywords so
  // the document advertises the Attestto countersignature.
  const lines: string[] = []
  if (carriedInfo.title) lines.push(`/Title ${pdfUnicodeString(carriedInfo.title)}`)
  if (carriedInfo.author) lines.push(`/Author ${pdfUnicodeString(carriedInfo.author)}`)
  if (carriedInfo.subject) lines.push(`/Subject ${pdfUnicodeString(carriedInfo.subject)}`)
  if (carriedInfo.creator) lines.push(`/Creator ${pdfUnicodeString(carriedInfo.creator)}`)
  lines.push(`/Producer ${pdfUnicodeString(producer)}`)
  lines.push(`/ModDate ${pdfDateString(new Date())}`)
  lines.push(`/Keywords ${pdfUnicodeString(keywordValue)}`)
  const infoDictBody = lines.join('\n')

  // Assemble the new revision. Per ISO 32000-1 §7.5.6, an incremental
  // update is appended after the previous %%EOF and starts with a
  // newline if the file doesn't already end with one.
  let revision = ''
  const lastByte = pdfBytes[pdfBytes.length - 1]
  if (lastByte !== 0x0a && lastByte !== 0x0d) revision += '\n'

  // New /Info object.
  const infoObjStartInRevision = revision.length
  revision += `${newInfoObj} 0 obj\n<<\n${infoDictBody}\n>>\nendobj\n`

  // Classic xref subsection. Two subsections so we don't have to touch
  // object 0 (which lives in the previous revision):
  //   subsection { newInfoObj, 1 } → our new /Info entry
  // Per spec each entry is exactly 20 bytes including the trailing EOL.
  const xrefStartInRevision = revision.length
  const infoOffset = pdfBytes.length + infoObjStartInRevision
  const offset10 = infoOffset.toString().padStart(10, '0')
  revision += 'xref\n'
  revision += `${newInfoObj} 1\n`
  revision += `${offset10} 00000 n \n` // exactly 20 bytes including the trailing space + LF

  // New trailer. Carry /Root from the prior revision, point /Info at
  // our new object, and chain /Prev to the previous startxref so PDF
  // readers walk the full revision history.
  revision += 'trailer\n'
  revision += `<< /Size ${newSize} /Root ${prior.rootRef} /Info ${newInfoObj} 0 R /Prev ${prior.prevStartxref} >>\n`

  // startxref + EOF.
  const newStartxref = pdfBytes.length + xrefStartInRevision
  revision += `startxref\n${newStartxref}\n%%EOF\n`

  // Concatenate as bytes. The revision is pure ASCII (UTF-16BE strings
  // are emitted as hex), so latin1 encode is safe and exact.
  const revBytes = TEXT_ENCODER.encode(revision)
  const out = new Uint8Array(pdfBytes.length + revBytes.length)
  out.set(pdfBytes, 0)
  out.set(revBytes, pdfBytes.length)

  return { pdfBytes: out, newInfoObj, newStartxref }
}

/**
 * Detect whether a PDF already carries a PAdES (or any) /Sig field. We
 * use this to decide whether to take the safe incremental path
 * (`appendKeywordRevision`) or the fast pdf-lib full-rewrite path.
 *
 * The check is intentionally byte-level: we don't want to decompress
 * anything, we just want to know if the file claims to have a signature.
 * Both indicators are checked because some producers omit /SigFlags but
 * still include the /Sig dict, and vice-versa.
 */
export function hasExistingSignature(bytes: Uint8Array): boolean {
  // Skim the entire file as latin1 — fast even for tens of MB.
  const text = TEXT_DECODER.decode(bytes)
  return /\/Type\s*\/Sig\b/.test(text) || /\/SigFlags\s+[13]\b/.test(text)
}
