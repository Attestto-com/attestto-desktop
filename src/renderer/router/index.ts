import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/unlock',
    name: 'unlock',
    component: () => import('@/views/VaultUnlockPage.vue'),
    meta: { skipGuards: true },
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/views/OnboardingPage.vue'),
    meta: { skipGuards: true },
  },
  {
    path: '/guardian-setup',
    name: 'guardian-setup',
    component: () => import('@/views/GuardianSetupPage.vue'),
    meta: { skipGuards: true },
  },
  {
    path: '/recovery',
    name: 'recovery',
    component: () => import('@/views/RecoveryPage.vue'),
    meta: { skipGuards: true },
  },
  {
    path: '/pdf',
    name: 'pdf',
    component: () => import('@/views/PdfPage.vue'),
    meta: { skipGuards: true },
  },
  {
    path: '/',
    redirect: '/settings',
  },
  {
    path: '/identity',
    name: 'identity',
    component: () => import('@/views/IdentityPage.vue'),
  },
  {
    path: '/exam',
    name: 'exam',
    component: () => import('@/views/ExamPage.vue'),
  },
  {
    path: '/explore',
    name: 'explore',
    component: () => import('@/views/ExploreModulesPage.vue'),
  },
  {
    path: '/credentials',
    name: 'credentials',
    component: () => import('@/views/CredentialsPage.vue'),
  },
  {
    path: '/present',
    name: 'present',
    component: () => import('@/views/PresentPage.vue'),
  },
  {
    path: '/session',
    name: 'session',
    component: () => import('@/views/SessionPage.vue'),
  },
  {
    path: '/audit',
    name: 'audit',
    component: () => import('@/views/AuditPage.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsPage.vue'),
  },
  // /signing route removed — PDF viewer is standalone at /pdf
  {
    path: '/notary-demo',
    name: 'notary-demo',
    component: () => import('@/views/NotaryDemoPage.vue'),
  },
  // ── Costa Rica document verification ──
  {
    path: '/verify/cr/cedula',
    name: 'cr-cedula',
    component: () => import('@/views/CedulaVerificationPage.vue'),
  },
  {
    path: '/verify/cr/dimex',
    name: 'cr-dimex',
    component: () => import('@/views/DimexVerificationPage.vue'),
  },
  // Sector placeholders
  {
    path: '/salud',
    name: 'salud',
    component: () => import('@/views/SectorPage.vue'),
  },
  {
    path: '/educacion',
    name: 'educacion',
    component: () => import('@/views/SectorPage.vue'),
  },
  {
    path: '/legal',
    name: 'legal',
    component: () => import('@/views/SectorPage.vue'),
  },
  {
    path: '/finanzas',
    name: 'finanzas',
    component: () => import('@/views/SectorPage.vue'),
  },
  {
    path: '/buzon',
    name: 'buzon',
    component: () => import('@/views/SectorPage.vue'),
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// Three-layer guard: vault exists? → vault unlocked? → onboarding complete?
router.beforeEach(async (to) => {
  if (to.meta.skipGuards) return true

  const api = window.presenciaAPI?.vault
  if (!api) {
    // Not in Electron — fallback to localStorage guard
    return fallbackGuard(to)
  }

  const status = await api.status()

  // Layer 1: No vault → create one
  if (!status.exists) {
    return { name: 'unlock' }
  }

  // Layer 2: Vault locked → unlock
  if (!status.unlocked) {
    return { name: 'unlock' }
  }

  return true
})

/** Fallback for browser dev mode (no Electron) */
function fallbackGuard(to: { name?: string | symbol | null | undefined }) {
  // No vault API → always go to unlock (which handles both create + unlock)
  if (to.name === 'unlock') return true
  return { name: 'unlock' }
}

export default router
