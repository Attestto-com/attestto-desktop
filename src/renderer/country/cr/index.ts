// ── Costa Rica Country Module ──
// Exports all CR-specific plugins, types, and configuration.
// The base app imports from here when the CR module is installed.

export { crDocumentPlugins } from './plugins'
export type { DocumentPlugin } from './plugins'
export { CR_CANTONS, getCantonByCodelec, getCantonsByProvince, getCantonDownloadUrl } from './cantons'
export type { CantonInfo } from './cantons'

/** CR module metadata */
export const CR_MODULE_ID = 'cr-identity'
export const CR_COUNTRY_CODE = 'CR'
export const CR_REGISTRY_URL = 'https://registry.attestto.cr/modules.json'

/**
 * TSE (Tribunal Supremo de Elecciones) — authority of record for CR civil identity.
 *
 * IMPORTANT: TSE is the *authority* (issued the physical cédula, runs the
 * Padrón). It is NOT the issuer of the W3C VC Attestto produces from a
 * cédula scan. The VC issuer is the Attestto station — see
 * `project_attestto_pay_model.md` and the storeCredential() flow.
 *
 * TSE has not yet published a DID. The web form is asserted by Attestto on
 * behalf of the CR namespace at attestto.id; the SNS form is held under
 * the Attestto-owned go-cr.sol root, reserved for TSE until they publish
 * their own. Both are listed as `evidence[].authority` in the VC, never as
 * `issuer`.
 */
export const TSE_AUTHORITY = {
  name: 'Tribunal Supremo de Elecciones',
  shortName: 'TSE',
  /** Web2 DID (primary — resolves today via attestto.id) */
  didWeb: 'did:web:attestto.id:cr:tse',
  /** SNS DID (reserved under our go-cr.sol root, not yet published on-chain) */
  didSns: 'did:sns:tse.go-cr',
  website: 'https://www.tse.go.cr',
}

/** Padrón Electoral nacional — the dataset Attestto cross-references against. */
export const PADRON_REGISTRY = {
  name: 'Padrón Electoral Nacional',
  didWeb: 'did:web:attestto.id:cr:tse:padron',
  didSns: 'did:sns:padron-tse.go-cr',
}

/** Cedula format: 9 digits, first digit = province (1-7) or special (8, 9) */
export function validateCedulaFormat(cedula: string): boolean {
  const clean = cedula.replace(/[^0-9]/g, '')
  if (clean.length !== 9) return false
  const first = parseInt(clean[0], 10)
  return first >= 1 && first <= 9
}

/** DIMEX format: 11 or 12 digits */
export function validateDimexFormat(dimex: string): boolean {
  const clean = dimex.replace(/[^0-9]/g, '')
  return clean.length === 11 || clean.length === 12
}

/** Format cedula with dashes: X-XXXX-XXXX */
export function formatCedula(cedula: string): string {
  const clean = cedula.replace(/[^0-9]/g, '')
  if (clean.length !== 9) return cedula
  return `${clean[0]}-${clean.substring(1, 5)}-${clean.substring(5)}`
}
