/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * All VC/VP signing surfaces MUST use this for deterministic serialization.
 * The resolver/verifier re-canonicalizes and checks against the proof — if
 * the canonicalization differs, the signature fails.
 */
export { canonicalize } from 'json-canonicalize'
