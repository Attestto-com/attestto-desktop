/**
 * SOC-191 — the encoding is checked against something that is not us.
 *
 * The defect this file exists for survived in three places at once because
 * every test asserted on the string our own formatter had just produced. Under
 * that kind of assertion base64url-behind-a-`z` is indistinguishable from
 * base58btc-behind-a-`z`: both are stable, both round-trip through our own
 * code, and both are wrong in the same direction everywhere.
 *
 * So none of the expected values below were computed by this codebase. They
 * were produced by `bs58` — a third-party base58 implementation — and pasted
 * in as literals, and the `did:key` for a 32-byte key of `0x07` also appears in
 * SOC-191 itself, derived independently before any of this code was written.
 * A literal cannot drift to match a bug in the encoder it is testing.
 *
 * The decode direction is checked the same way: recover the bytes and compare
 * them to the SOURCE KEY, never to the string we just emitted.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  base58btcDecode,
  base58btcEncode,
  didKeyFromEd25519PublicKey,
  didKeyMatchesPublicKey,
  ed25519PublicKeyFromDidKey,
  ED25519_DID_KEY_PREFIX,
} from '../src/shared/did-key'

/** Expected values produced by `bs58`, not by this codebase. */
const VECTORS: Array<{ name: string; key: Uint8Array; did: string }> = [
  {
    // The vector in SOC-191, derived before this module existed.
    name: 'thirty-two 0x07 bytes',
    key: new Uint8Array(32).fill(7),
    did: 'did:key:z6Mkevh7bMWWUda468bFjfFGtDxLXgkG8L46bsaXEwHD9Z3L',
  },
  {
    name: 'all-zero key',
    key: new Uint8Array(32),
    did: 'did:key:z6MkeTG3bFFSLYVU7VqhgZxqr6YzpaGrQtFMh1uvqGy1vDnP',
  },
  {
    name: 'all-0xff key',
    key: new Uint8Array(32).fill(255),
    did: 'did:key:z6MkwgaR63138bEEgad7uk993KMX54vBA6KTB4sFhCPnSB2e',
  },
  {
    name: 'counting key',
    key: Uint8Array.from({ length: 32 }, (_, i) => i),
    did: 'did:key:z6MkeTGwHmLmuCmgg4ABYhzWVh6ZX7hTwWt8gguAretUfc9c',
  },
]

describe('base58btc, against a third-party encoder', () => {
  // Byte strings chosen for the case a hand-written codec gets wrong: leading
  // zero bytes, which base58 represents as leading `1`s rather than as digits.
  const RAW: Array<[string, string]> = [
    ['00', '1'],
    ['0000ff', '115Q'],
    ['ff', '5Q'],
    ['deadbeef', '6h8cQN'],
    ['000102', '15T'],
  ]

  for (const [hex, expected] of RAW) {
    it(`encodes ${hex} as ${expected}`, () => {
      expect(base58btcEncode(Uint8Array.from(Buffer.from(hex, 'hex')))).toBe(expected)
    })

    it(`decodes ${expected} back to ${hex}`, () => {
      expect(Buffer.from(base58btcDecode(expected)).toString('hex')).toBe(hex)
    })
  }

  it('refuses characters outside the alphabet', () => {
    // `0`, `O`, `I` and `l` are excluded precisely because they are confusable.
    // Accepting them would decode a mistyped identifier to the wrong key.
    for (const bad of ['0', 'O', 'I', 'l', '+', '/', '=']) {
      expect(() => base58btcDecode(`6h8${bad}cQN`)).toThrow(/base58/)
    }
  })
})

describe('did:key', () => {
  for (const { name, key, did } of VECTORS) {
    it(`derives the published DID for the ${name}`, () => {
      expect(didKeyFromEd25519PublicKey(key)).toBe(did)
    })

    it(`recovers the source key bytes from the ${name} DID`, () => {
      // The assertion the old code could never have passed: decode the emitted
      // identifier and compare against the bytes that went in.
      const recovered = ed25519PublicKeyFromDidKey(didKeyFromEd25519PublicKey(key))
      expect(recovered).not.toBeNull()
      expect(Buffer.from(recovered!).toString('hex')).toBe(Buffer.from(key).toString('hex'))
    })
  }

  it('always begins z6Mk for ed25519', () => {
    // The tell that needed no decoder. Everything this app minted began z7QE.
    for (const { key } of VECTORS) {
      expect(didKeyFromEd25519PublicKey(key).startsWith(ED25519_DID_KEY_PREFIX)).toBe(true)
    }
  })

  it('rejects the malformed form this app used to mint', () => {
    // base64url behind a `z`. A conforming decoder must not read it, or the
    // migration silently keeps working and the old identifiers never die.
    const legacy = 'did:key:z7QEHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw'
    expect(ed25519PublicKeyFromDidKey(legacy)).toBeNull()
  })

  it('refuses a key that is not 32 bytes', () => {
    expect(() => didKeyFromEd25519PublicKey(new Uint8Array(31))).toThrow(/32 bytes/)
    expect(() => didKeyFromEd25519PublicKey(new Uint8Array(33))).toThrow(/32 bytes/)
  })

  it('returns null rather than throwing for anything unreadable', () => {
    for (const bad of ['', 'did:key:', 'did:key:abc', 'did:sns:alice.crbank', 'z6Mk', 'did:key:z0O']) {
      expect(ed25519PublicKeyFromDidKey(bad)).toBeNull()
    }
  })

  it('rejects a well-formed base58 payload carrying another key type', () => {
    // multicodec 0x1200 is P-256. The bytes decode cleanly; they are not an
    // ed25519 key, and treating them as one would verify against 32 bytes of
    // something else.
    const p256ish = base58btcEncode(Uint8Array.from([0x12, 0x00, ...new Uint8Array(32).fill(9)]))
    expect(ed25519PublicKeyFromDidKey(`did:key:z${p256ish}`)).toBeNull()
  })
})

describe('the copy inlined into the capture-server page', () => {
  /**
   * `capture-server.ts` serves a script to the phone's browser as text, so it
   * cannot import `did-key.ts`. That makes it the one surviving second
   * implementation — and a second implementation drifting from the first is
   * exactly how SOC-191 stayed alive across three files.
   *
   * This does not read the source and assert on its text. It EXTRACTS the
   * shipped functions and RUNS them against the same third-party vectors the
   * module is held to, so the two can only agree by actually agreeing.
   */
  const source = readFileSync(
    new URL('../src/main/capture/capture-server.ts', import.meta.url),
    'utf-8',
  )

  const extract = (name: string): string => {
    const start = source.indexOf(`function ${name}(`)
    expect(start, `${name} not found in capture-server.ts`).toBeGreaterThan(-1)
    let depth = 0
    for (let i = source.indexOf('{', start); i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
    }
    throw new Error(`could not find the end of ${name}`)
  }

  // `new Function` over a string is a code-injection hazard whenever the string
  // can come from outside. Here both inputs are this repository's own source,
  // read from disk inside a test that already executes this repository's code —
  // anyone able to change them can change the test itself. It is confined to
  // the test tree and must never appear in `src/`.
  const alphabet = /var B58='([^']+)'/.exec(source)?.[1]
  const didKeyToPub = new Function(
    `var B58='${alphabet}';${extract('b58ToBytes')}${extract('didKeyToPub')}return didKeyToPub`,
  )() as (did: string) => Uint8Array | null

  for (const { name, key, did } of VECTORS) {
    it(`recovers the ${name} exactly as the module does`, () => {
      const recovered = didKeyToPub(did)
      expect(recovered).not.toBeNull()
      expect(Buffer.from(recovered!).toString('hex')).toBe(Buffer.from(key).toString('hex'))
    })
  }

  it('rejects the malformed base64url form the page used to accept', () => {
    expect(didKeyToPub('did:key:z7QEHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw')).toBeNull()
  })

  it('rejects a payload that is not an ed25519 key', () => {
    const p256ish = base58btcEncode(Uint8Array.from([0x12, 0x00, ...new Uint8Array(32).fill(9)]))
    expect(didKeyToPub(`did:key:z${p256ish}`)).toBeNull()
  })
})

describe('didKeyMatchesPublicKey', () => {
  const key = VECTORS[0].key

  it('accepts the DID derived from the key', () => {
    expect(didKeyMatchesPublicKey(VECTORS[0].did, key)).toBe(true)
  })

  it('rejects a DID for a different key', () => {
    // The case `checkIssuerBinding` could never detect: a valid did:key that
    // is not the signer's.
    expect(didKeyMatchesPublicKey(VECTORS[3].did, key)).toBe(false)
  })

  it('rejects a malformed DID', () => {
    expect(didKeyMatchesPublicKey('did:key:z7QEHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw', key)).toBe(false)
    expect(didKeyMatchesPublicKey('did:sns:alice.crbank', key)).toBe(false)
  })
})
