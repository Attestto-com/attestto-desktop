// ── Module Manifest ──────────────────────────
// Each module (marketplace plugin) declares what it contributes
// to the adaptive home screen and how often it's typically used.

export type PersonaType =
  | 'citizen'
  | 'legal'
  | 'health'
  | 'education'
  | 'finance'
  | 'government'
  | 'custom'

export type UsageProfile = 'once' | 'rare' | 'periodic' | 'frequent' | 'daily'

export type SectorId =
  | 'core'
  | 'gobierno'
  | 'legal'
  | 'salud'
  | 'educacion'
  | 'finanzas'
  | 'buzon'

export interface QuickAction {
  id: string
  label: string
  icon: string
  route: string
  color?: string
}

export interface PendingItem {
  id: string
  moduleId: string
  label: string
  icon: string
  route: string
  count?: number
  urgency: 'low' | 'normal' | 'high'
}

export interface StatsCard {
  label: string
  icon: string
  color: string
  /** Reactive getter — called by home screen to get current value */
  getValue: () => string | number
}

export interface ModuleManifest {
  id: string
  name: string
  description: string
  icon: string
  sector: SectorId
  route: string

  /** Which personas get this module pre-installed */
  defaultFor: PersonaType[]

  /** How often does a typical user need this? */
  usageProfile: UsageProfile

  /** What this module surfaces on the home screen */
  homeWidgets?: {
    pendingActions?: () => PendingItem[]
    quickAction?: QuickAction
    statsCard?: StatsCard
  }

  /** Nav tab config — if module should appear in the sector tab bar */
  navTab?: {
    label: string
    icon: string
    badge?: string
  }
}

export interface ActivityEntry {
  moduleId: string
  action: string
  timestamp: number
}

export interface PersonaProfile {
  type: PersonaType
  installedModules: string[]
  pinnedActions: string[]
  activityLog: ActivityEntry[]
  onboardingComplete: boolean
}
