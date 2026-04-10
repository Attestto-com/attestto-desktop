// ── Module Registry ──────────────────────────
// All available modules and their manifests.
// Modules declare which personas they're relevant for,
// usage frequency, and what they contribute to the home screen.

import type { ModuleManifest } from '../types/module-manifest'

export const moduleRegistry: ModuleManifest[] = [
  // ── Core (always available) ──
  {
    id: 'identity',
    name: 'Identidad Digital',
    description: 'DID, biometria, Firma Digital, credenciales verificables',
    icon: 'fingerprint',
    sector: 'core',
    route: '/identity',
    defaultFor: ['citizen', 'legal', 'health', 'education', 'finance', 'government'],
    usageProfile: 'rare',
    homeWidgets: {
      quickAction: {
        id: 'identity',
        label: 'Identidad',
        icon: 'fingerprint',
        route: '/identity',
      },
    },
    navTab: { label: 'Identidad', icon: 'fingerprint' },
  },
  // document-signing module removed — PDF viewer is standalone at /pdf
  // Signing flow will be re-added when @attestto/pdf signer is ready
  {
    id: 'credentials',
    name: 'Credenciales',
    description: 'Wallet de credenciales verificables — almacenar, presentar, compartir',
    icon: 'verified',
    sector: 'core',
    route: '/credentials',
    defaultFor: ['citizen', 'legal', 'education', 'finance'],
    usageProfile: 'periodic',
    homeWidgets: {
      quickAction: {
        id: 'credentials',
        label: 'Credenciales',
        icon: 'verified',
        route: '/credentials',
        color: 'positive',
      },
      statsCard: {
        label: 'Credenciales',
        icon: 'verified',
        color: 'positive',
        getValue: () => 0,
      },
    },
  },

  // ── Costa Rica ──
  {
    id: 'cr-identity',
    name: 'Identidad CR',
    description: 'Verificacion de cedula, DIMEX y pasaporte — Tribunal Supremo de Elecciones',
    icon: 'badge',
    sector: 'gobierno',
    route: '/verify/cr/cedula',
    defaultFor: ['citizen', 'legal', 'health', 'education', 'finance', 'government'],
    usageProfile: 'rare',
    homeWidgets: {
      statsCard: {
        label: 'Documentos CR',
        icon: 'badge',
        color: 'primary',
        getValue: () => 0,
      },
    },
  },

  // ── Gobierno (country-specific — installed by country modules, not base) ──
  {
    id: 'cosevi-exam',
    name: 'Prueba Teorica COSEVI',
    description: 'Examen de manejo con proctoring biometrico y sello blockchain',
    icon: 'quiz',
    sector: 'gobierno',
    route: '/exam',
    defaultFor: ['government'],
    usageProfile: 'once',
    homeWidgets: {
      quickAction: {
        id: 'cosevi-exam',
        label: 'Examen COSEVI',
        icon: 'quiz',
        route: '/exam',
        color: 'primary',
      },
    },
    navTab: { label: 'Gobierno', icon: 'account_balance', badge: 'MOPT' },
  },

  // ── Legal ──
  {
    id: 'notary-workspace',
    name: 'Espacio Notarial',
    description: 'Actos notariales digitales, protocolizacion, referencias registrales',
    icon: 'gavel',
    sector: 'legal',
    route: '/notary-demo',
    defaultFor: ['legal'],
    usageProfile: 'daily',
    homeWidgets: {
      quickAction: {
        id: 'notary',
        label: 'Notariado',
        icon: 'gavel',
        route: '/notary-demo',
      },
    },
    navTab: { label: 'Legal', icon: 'gavel' },
  },
  {
    id: 'remote-hearings',
    name: 'Audiencias Remotas',
    description: 'Poder Judicial — audiencias verificadas con presencia biometrica',
    icon: 'groups',
    sector: 'legal',
    route: '/legal',
    defaultFor: ['legal'],
    usageProfile: 'periodic',
  },

  // ── Salud (country-specific) ──
  {
    id: 'ccss-appointments',
    name: 'Citas CCSS',
    description: 'Citas medicas verificadas, historial clinico portable',
    icon: 'local_hospital',
    sector: 'salud',
    route: '/salud',
    defaultFor: ['health'],
    usageProfile: 'periodic',
    navTab: { label: 'Salud', icon: 'local_hospital' },
  },

  // ── Educacion ──
  {
    id: 'university-admission',
    name: 'Admision Universitaria',
    description: 'Examenes de admision proctoreados, titulos como VC',
    icon: 'school',
    sector: 'educacion',
    route: '/educacion',
    defaultFor: ['education'],
    usageProfile: 'once',
    navTab: { label: 'Educacion', icon: 'school' },
  },

  // ── Finanzas ──
  {
    id: 'kyc-banking',
    name: 'KYC Bancario',
    description: 'KYC verificado, onboarding financiero, compliance',
    icon: 'account_balance_wallet',
    sector: 'finanzas',
    route: '/finanzas',
    defaultFor: ['finance'],
    usageProfile: 'rare',
    navTab: { label: 'Finanzas', icon: 'account_balance_wallet' },
  },

  // ── Buzon (country-specific) ──
  {
    id: 'buzon-nacional',
    name: 'Buzon Nacional',
    description: 'Notificaciones oficiales via DIDComm — acuse de recibo legal',
    icon: 'mail_outline',
    sector: 'buzon',
    route: '/buzon',
    defaultFor: ['legal', 'government'],
    usageProfile: 'frequent',
    navTab: { label: 'Buzon', icon: 'mail_outline' },
  },

  // ── Auditoria (utility, not a sector tab) ──
  {
    id: 'audit',
    name: 'Auditoria',
    description: 'Trail de auditoria inmutable, anclas Solana, reportes',
    icon: 'history',
    sector: 'core',
    route: '/audit',
    defaultFor: ['legal', 'government', 'finance'],
    usageProfile: 'periodic',
    homeWidgets: {
      statsCard: {
        label: 'Anclas Solana',
        icon: 'link',
        color: 'accent',
        getValue: () => 0,
      },
    },
  },
]

/** Get modules that should be pre-installed for a persona */
export function getDefaultModules(persona: string): string[] {
  return moduleRegistry
    .filter(m => m.defaultFor.includes(persona as any))
    .map(m => m.id)
}

/** Look up a module by ID */
export function getModule(id: string): ModuleManifest | undefined {
  return moduleRegistry.find(m => m.id === id)
}
