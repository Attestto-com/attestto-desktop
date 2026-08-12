// Shared name normalization/validation for Costa Rica cédula OCR.
// Kept dependency-free (no tesseract import) so it is cheap to unit-test and
// reusable by both the OCR parser and the verification view.

/**
 * Normalize an OCR-extracted name value and reject implausible results.
 *
 * Returns the cleaned name, or '' if the value is not a plausible name. This
 * guards the case where label-stripping leaves a single stray letter (e.g. "a"),
 * which previously flowed unchecked into the issued Nivel-B credential.
 */
export function sanitizeName(raw: string): string {
  if (!raw) return ''
  // Keep letters (incl. Spanish accents / ñ) and spaces only.
  const cleaned = raw
    .replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 2) return ''
  // Require at least one word of >= 2 letters. Blocks "a", "a b c", "x 1".
  const hasRealWord = cleaned.split(' ').some((tok) => tok.length >= 2)
  if (!hasRealWord) return ''
  return cleaned
}
