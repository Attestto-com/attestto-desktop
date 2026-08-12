/**
 * `did:key` for ed25519 — the one derivation, used everywhere.
 *
 * SOC-191. Three call sites built this identifier independently
 * (`vault-service.ts`, `station-service.ts`, `CedulaVerificationPage.vue`) and
 * all three made the same mistake: multicodec-prefix the key correctly, then
 * **base64url**-encode it behind a `z`. `z` is the multibase code for
 * base58btc. The payload was not base58btc.
 *
 *     what this app minted   did:key:z7QEHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw
 *     what did:key specifies did:key:z6Mkevh7bMWWUda468bFjfFGtDxLXgkG8L46bsaXEwHD9Z3L
 *
 * Every DID this app minted was therefore undecodable by any conforming
 * resolver: multibase-decoding the suffix yields unrelated bytes, so the public
 * key cannot be recovered and nothing the desktop signs can be verified, no
 * matter how correct the signature is. The tell needs no decoder — an ed25519
 * `did:key` always begins `z6Mk`, and these began `z7QE`.
 *
 * 🔑 **A multibase prefix is a claim about an encoding, and nothing checked
 * that the claim was true.** This was the third instance in a month: the
 * `did:sns` resolver emitted an ECIES key as `"z" + <hex>`, and emitted
 * `publicKeyBase58` under a context that does not define the term. All three
 * survived because the tests asserted on the string our own formatter had just
 * produced. The only assertion that catches this is one that **decodes the
 * output and compares against the input bytes**, which is what
 * `did-key.test.ts` does, against a hardcoded vector it does not compute.
 *
 * ## Why base58 is implemented here rather than imported
 *
 * The renderer and the Electron main process both need it, and the capture
 * server injects a copy into a page it serves, where no import is possible.
 * Adding a dependency for ~30 lines that must exist inline anyway would leave
 * two implementations, which is the condition this file exists to end. The
 * risk of a hand-written codec is that it agrees with itself; the tests
 * therefore check it against published `did:key` vectors, not against itself.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** multicodec `ed25519-pub`, varint-encoded. */
const ED25519_PUB_PREFIX = [0xed, 0x01] as const

const ED25519_PUBLIC_KEY_BYTES = 32

/** Every ed25519 `did:key` starts with this, because the prefix bytes are fixed. */
export const ED25519_DID_KEY_PREFIX = 'did:key:z6Mk'

/** base58btc encode. Leading zero bytes become leading `1`s, per the alphabet's spec. */
export function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''

  const digits: number[] = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8
      digits[i] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }

  // Drop the high-order zero digits the accumulator started with. Without
  // this, a leading zero byte is counted twice — once as the `1` below and
  // once as a `0` digit — and `00` encodes as `11` instead of `1`. Caught by
  // the third-party vectors, not by any round trip through this file: encode
  // and decode were wrong symmetrically, so they agreed with each other.
  let significant = digits.length
  while (significant > 0 && digits[significant - 1] === 0) significant--

  let out = ''
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += BASE58_ALPHABET[0]
  for (let i = significant - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]]
  return out
}

/** base58btc decode. Throws on any character outside the alphabet. */
export function base58btcDecode(value: string): Uint8Array {
  if (value.length === 0) return new Uint8Array(0)

  const bytes: number[] = [0]
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char)
    if (index < 0) {
      throw new Error(`not base58btc: unexpected character ${JSON.stringify(char)}`)
    }
    let carry = index
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Same trimming as the encoder, for the same reason: the accumulator's
  // initial zero is not a byte of the value.
  let significant = bytes.length
  while (significant > 0 && bytes[significant - 1] === 0) significant--

  let leadingZeros = 0
  for (let i = 0; i < value.length && value[i] === BASE58_ALPHABET[0]; i++) leadingZeros++

  const out = new Uint8Array(leadingZeros + significant)
  for (let i = 0; i < significant; i++) out[leadingZeros + i] = bytes[significant - 1 - i]
  return out
}

/**
 * The `did:key` for a raw 32-byte ed25519 public key.
 *
 * @throws if the key is not 32 bytes. A shorter or longer buffer would produce
 *         a well-formed-looking DID that decodes to something that is not a
 *         key, which is the failure this whole module exists to prevent.
 */
export function didKeyFromEd25519PublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(`ed25519 public key must be 32 bytes, got ${publicKey.length}`)
  }
  const tagged = new Uint8Array(ED25519_PUB_PREFIX.length + publicKey.length)
  tagged.set(ED25519_PUB_PREFIX, 0)
  tagged.set(publicKey, ED25519_PUB_PREFIX.length)
  return `did:key:z${base58btcEncode(tagged)}`
}

/**
 * The raw 32-byte ed25519 public key inside a `did:key`, or null.
 *
 * Null rather than a throw because every caller is a verifier deciding whether
 * to trust something: an unreadable DID is a verification failure, not an
 * exceptional condition.
 */
export function ed25519PublicKeyFromDidKey(did: string): Uint8Array | null {
  const match = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)$/.exec(did ?? '')
  if (!match) return null

  let decoded: Uint8Array
  try {
    decoded = base58btcDecode(match[1])
  } catch {
    return null
  }

  if (decoded[0] !== ED25519_PUB_PREFIX[0] || decoded[1] !== ED25519_PUB_PREFIX[1]) return null

  const key = decoded.subarray(ED25519_PUB_PREFIX.length)
  return key.length === ED25519_PUBLIC_KEY_BYTES ? key : null
}

/** Whether a `did:key` encodes exactly this public key. Constant-time is not needed: both values are public. */
export function didKeyMatchesPublicKey(did: string, publicKey: Uint8Array): boolean {
  const recovered = ed25519PublicKeyFromDidKey(did)
  if (!recovered || recovered.length !== publicKey.length) return false
  return recovered.every((byte, i) => byte === publicKey[i])
}
