/**
 * SOC-174 — the verification method a proof names.
 *
 * Nine sites in this app built `${did}#key-1` inline. The DID they build it
 * from is the vault identity, which is a `did:key`, and **`did:key` has no
 * `#key-1`**: the DID Core registration for the method defines the verification
 * method id as the DID followed by the method-specific identifier repeated as
 * the fragment, `did:key:z6Mk…#z6Mk…`.
 *
 * So every presentation, credential export and signed PDF this app produced
 * named a verification method that does not exist in the signer's own DID
 * Document. A verifier resolving it finds no such key and reports an ordinary
 * signature failure, indistinguishable from a wrong key.
 *
 * `#key-1` is one method's convention and not a universal fragment. did:sns
 * §8.5 names its owner key `#solana-key`; did:jwk uses `#0`; a did:web document
 * names whatever it names. There is no method in this app for which the inline
 * default was right.
 *
 * This module refuses for any method whose fragment rule it does not know,
 * rather than guessing one. Guessing is what produced the defect.
 */

/** Methods whose verification-method id is derivable from the DID alone. */
const DERIVABLE = new Set(['key'])

/**
 * The verification method URI for a DID whose fragment rule is known.
 *
 * @throws if the DID is malformed, or if its method has no derivable fragment.
 *         An unknown method means the caller must resolve the document and read
 *         the fragment out of it; it does not mean a fragment may be invented.
 */
export function verificationMethodFor(did: string): string {
  if (!did.startsWith('did:')) {
    throw new Error(`not a DID: ${did}`)
  }
  if (did.includes('#')) {
    throw new Error(`already a DID URL, not a DID: ${did}`)
  }

  const [, method, ...rest] = did.split(':')
  const methodSpecificId = rest.join(':')
  if (!method || !methodSpecificId) {
    throw new Error(`malformed DID: ${did}`)
  }

  if (!DERIVABLE.has(method)) {
    throw new Error(
      `cannot derive a verification method for did:${method} — resolve the DID Document and read the fragment from it`,
    )
  }

  // did:key: the fragment IS the method-specific identifier.
  return `${did}#${methodSpecificId}`
}
