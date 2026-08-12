import { describe, it, expect } from 'vitest'
import { verificationMethodFor } from '../src/shared/verification-method'

const DID_KEY = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'

describe('SOC-174 — the verification method is derived, never guessed', () => {
  it('did:key repeats the method-specific id as the fragment', () => {
    // Not `#key-1`. The DID Core method registration defines the verification
    // method id this way, and it is the only fragment a did:key document has.
    expect(verificationMethodFor(DID_KEY)).toBe(
      `${DID_KEY}#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`,
    )
  })

  it('never produces #key-1 for any input it accepts', () => {
    expect(verificationMethodFor(DID_KEY)).not.toContain('#key-1')
  })

  it('refuses a method whose fragment rule it does not know', () => {
    // The whole point: an unknown method means resolve the document, not invent
    // a fragment. did:sns names its owner key `#solana-key` (§8.5) and did:web
    // names whatever its document names — neither is derivable from the DID.
    expect(() => verificationMethodFor('did:sns:alice.crbank')).toThrow(/did:sns/)
    expect(() => verificationMethodFor('did:web:example.com')).toThrow(/did:web/)
  })

  it('refuses a DID URL that already carries a fragment', () => {
    expect(() => verificationMethodFor(`${DID_KEY}#anything`)).toThrow(/already a DID URL/)
  })

  it('refuses anything that is not a DID', () => {
    expect(() => verificationMethodFor('z6MkhaXgBZ')).toThrow(/not a DID/)
    expect(() => verificationMethodFor('did:key:')).toThrow(/malformed/)
  })
})
