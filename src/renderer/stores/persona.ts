// ── Persona Store ────────────────────────────
// Drives the adaptive UI: which modules are installed,
// what the user does most, and what they've pinned.
// Persists to vault (encrypted) with localStorage fallback for pre-vault state.

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PersonaType, ActivityEntry, PendingItem, QuickAction, StatsCard } from '../types/module-manifest'
import { moduleRegistry, getDefaultModules, getModule } from '../registry/modules'

const STORAGE_KEY = 'attestto-persona'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

async function loadFromVault() {
  try {
    const api = window.presenciaAPI?.vault
    if (!api) return null
    const contents = await api.read()
    if (!contents) return null
    return contents.persona
  } catch { return null }
}

export const usePersonaStore = defineStore('persona', () => {
  // ── State ──
  const personaType = ref<PersonaType>('citizen')
  const installedModules = ref<string[]>([])
  const pinnedActions = ref<string[]>([])
  const activityLog = ref<ActivityEntry[]>([])
  const onboardingComplete = ref(false)

  // ── Init from storage ──
  const saved = loadFromStorage()
  if (saved) {
    personaType.value = saved.type || 'citizen'
    installedModules.value = saved.installedModules || []
    pinnedActions.value = saved.pinnedActions || []
    activityLog.value = saved.activityLog || []
    onboardingComplete.value = saved.onboardingComplete || false

  }

  // Auto-install country module based on system timezone
  function ensureCountryModule() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    const countryModuleMap: Record<string, string> = {
      'America/Costa_Rica': 'cr-identity',
    }
    const countryModule = countryModuleMap[tz]
    if (countryModule && !installedModules.value.includes(countryModule)) {
      installedModules.value.push(countryModule)
      // Only save to localStorage (safe, no IPC cloning issues)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        type: personaType.value,
        installedModules: installedModules.value,
        pinnedActions: pinnedActions.value,
        activityLog: activityLog.value,
        onboardingComplete: onboardingComplete.value,
      }))
    }
  }

  ensureCountryModule()

  // ── Persist ──
  function persist() {
    const data = {
      type: personaType.value,
      installedModules: installedModules.value,
      pinnedActions: pinnedActions.value,
      activityLog: activityLog.value,
      onboardingComplete: onboardingComplete.value,
    }

    // Always write to localStorage as fallback
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

    // Write to vault if available and unlocked
    // Deep-clone to strip Vue reactive proxies — IPC uses structuredClone which chokes on them
    const api = window.presenciaAPI?.vault
    if (api) {
      api.write({ persona: JSON.parse(JSON.stringify(data)) }).catch(() => {
        // Vault may not be unlocked yet — localStorage is the fallback
      })
    }
  }

  /** Load state from vault (called after vault unlock) */
  async function loadFromVaultIfAvailable() {
    const vaultData = await loadFromVault()
    if (vaultData) {
      personaType.value = (vaultData.type as PersonaType) || 'citizen'
      installedModules.value = vaultData.installedModules || []
      pinnedActions.value = vaultData.pinnedActions || []
      activityLog.value = vaultData.activityLog || []
      onboardingComplete.value = vaultData.onboardingComplete || false
      // Migrate: clear localStorage since vault is authoritative
      localStorage.removeItem(STORAGE_KEY)
      // Re-apply country module detection after vault load
      ensureCountryModule()
    }
  }

  // ── Actions ──

  /** Set persona during onboarding — pre-installs relevant modules */
  function setPersona(type: PersonaType) {
    personaType.value = type
    installedModules.value = getDefaultModules(type)
    // Auto-pin daily-use modules for this persona
    pinnedActions.value = moduleRegistry
      .filter(m =>
        installedModules.value.includes(m.id)
        && m.homeWidgets?.quickAction
        && (m.usageProfile === 'daily' || m.usageProfile === 'frequent'),
      )
      .map(m => m.homeWidgets!.quickAction!.id)
    onboardingComplete.value = true
    persist()
  }

  function installModule(moduleId: string) {
    if (!installedModules.value.includes(moduleId)) {
      installedModules.value.push(moduleId)
      persist()
    }
  }

  function uninstallModule(moduleId: string) {
    installedModules.value = installedModules.value.filter(id => id !== moduleId)
    pinnedActions.value = pinnedActions.value.filter(id => {
      const mod = moduleRegistry.find(m => m.homeWidgets?.quickAction?.id === id)
      return mod?.id !== moduleId
    })
    persist()
  }

  function togglePin(actionId: string) {
    const idx = pinnedActions.value.indexOf(actionId)
    if (idx >= 0) {
      pinnedActions.value.splice(idx, 1)
    } else {
      pinnedActions.value.push(actionId)
    }
    persist()
  }

  function trackActivity(moduleId: string, action: string) {
    activityLog.value.push({
      moduleId,
      action,
      timestamp: Date.now(),
    })
    // Keep only last 500 entries
    if (activityLog.value.length > 500) {
      activityLog.value = activityLog.value.slice(-500)
    }
    persist()
  }

  // ── Computed ──

  /** Modules the user has installed, resolved to full manifests */
  const activeModules = computed(() =>
    installedModules.value
      .map(id => getModule(id))
      .filter((m): m is NonNullable<typeof m> => !!m),
  )

  /** Sector tabs to show in nav — derived from installed modules */
  const activeSectorTabs = computed(() => {
    const seen = new Set<string>()
    const tabs: { label: string; icon: string; route: string; badge?: string }[] = []

    // Always show home
    tabs.push({ label: 'Inicio', icon: 'dashboard', route: '/' })

    for (const mod of activeModules.value) {
      if (!mod.navTab) continue
      const key = mod.sector + mod.navTab.label
      if (seen.has(key)) continue
      seen.add(key)
      tabs.push({
        label: mod.navTab.label,
        icon: mod.navTab.icon,
        route: mod.route,
        badge: mod.navTab.badge,
      })
    }
    return tabs
  })

  /** Quick actions for home screen — pinned first, then by recent frequency */
  const quickActions = computed((): QuickAction[] => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recentActivity = activityLog.value.filter(a => a.timestamp > thirtyDaysAgo)

    // Count recent uses per module
    const freq = new Map<string, number>()
    for (const entry of recentActivity) {
      freq.set(entry.moduleId, (freq.get(entry.moduleId) || 0) + 1)
    }

    // Collect all available quick actions from installed modules
    const actions: (QuickAction & { pinned: boolean; frequency: number })[] = []
    for (const mod of activeModules.value) {
      const qa = mod.homeWidgets?.quickAction
      if (!qa) continue
      actions.push({
        ...qa,
        pinned: pinnedActions.value.includes(qa.id),
        frequency: freq.get(mod.id) || 0,
      })
    }

    // Sort: pinned first, then by frequency
    actions.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.frequency - a.frequency
    })

    // Max 6 on home screen
    return actions.slice(0, 6)
  })

  /** Pending items aggregated from all installed modules */
  const pendingItems = computed((): PendingItem[] => {
    const items: PendingItem[] = []
    for (const mod of activeModules.value) {
      const getter = mod.homeWidgets?.pendingActions
      if (getter) items.push(...getter())
    }
    return items.sort((a, b) => {
      const urgencyOrder = { high: 0, normal: 1, low: 2 }
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency]
    })
  })

  /** Stats cards from installed modules */
  const statsCards = computed((): StatsCard[] =>
    activeModules.value
      .map(m => m.homeWidgets?.statsCard)
      .filter((s): s is StatsCard => !!s),
  )

  /** Recent activity for the home feed — last 8 unique actions */
  const recentActivity = computed(() => {
    const seen = new Set<string>()
    const recent: { moduleId: string; moduleName: string; moduleIcon: string; action: string; timestamp: number }[] = []

    for (let i = activityLog.value.length - 1; i >= 0 && recent.length < 8; i--) {
      const entry = activityLog.value[i]
      const key = `${entry.moduleId}:${entry.action}`
      if (seen.has(key)) continue
      seen.add(key)
      const mod = getModule(entry.moduleId)
      if (mod) {
        recent.push({
          ...entry,
          moduleName: mod.name,
          moduleIcon: mod.icon,
        })
      }
    }
    return recent
  })

  /** Modules available in marketplace but not installed */
  const availableModules = computed(() =>
    moduleRegistry.filter(m => !installedModules.value.includes(m.id)),
  )

  /** Whether the home should show a calm/minimal view (citizen with little activity) */
  const isMinimalHome = computed(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recentCount = activityLog.value.filter(a => a.timestamp > thirtyDaysAgo).length
    return personaType.value === 'citizen' && recentCount < 5
  })

  return {
    // State
    personaType,
    installedModules,
    pinnedActions,
    activityLog,
    onboardingComplete,
    // Actions
    setPersona,
    loadFromVaultIfAvailable,
    installModule,
    uninstallModule,
    togglePin,
    trackActivity,
    // Computed
    activeModules,
    activeSectorTabs,
    quickActions,
    pendingItems,
    statsCards,
    recentActivity,
    availableModules,
    isMinimalHome,
  }
})
