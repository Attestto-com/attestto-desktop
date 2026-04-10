import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  VaultContents,
  VaultStatus,
  VaultSettings,
  VaultGuardians,
  GuardianBackupResult,
} from '../../shared/vault-api'

export const useVaultStore = defineStore('vault', () => {
  // ── State ──────────────────────────────────────────

  const status = ref<VaultStatus>({
    exists: false,
    unlocked: false,
    did: null,
  })

  const settings = ref<VaultSettings>({
    solanaNetwork: 'devnet',
    language: 'es',
    firmaDigitalLevel: 'self-attested',
  })

  const guardians = ref<VaultGuardians>({
    configured: false,
    threshold: 2,
    guardianDids: [],
    backupVersion: 0,
  })

  const error = ref<string | null>(null)
  const loading = ref(false)

  // ── Computed ───────────────────────────────────────

  const isUnlocked = computed(() => status.value.unlocked)
  const vaultExists = computed(() => status.value.exists)
  const did = computed(() => status.value.did)
  const guardiansConfigured = computed(() => guardians.value.configured)
  // Set by storeCredential() in the verify flow as a cheap, sync signal that
  // doesn't require an unlocked vault read. Survives the localStorage→vault
  // migration because it's a separate flag, not the credential itself.
  const identityVerifiedFlag = ref(localStorage.getItem('attestto-identity-verified') === '1')

  const identityVerified = computed(() => {
    if (identityVerifiedFlag.value) return true

    // Fallback: scan localStorage for legacy credentials (old shape OR new
    // W3C shape that hasn't been migrated to the vault yet).
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('attestto-credential-')) {
        try {
          const cred = JSON.parse(localStorage.getItem(key)!)
          // New W3C shape
          if (cred?.credentialSubject?.cedula && cred?.evidence?.[0]?.padronMatch) return true
          // Old flat shape
          if (cred?.data?.cedula && cred?.data?.tseValidated) return true
        } catch { /* ignore malformed */ }
      }
    }
    return false
  })

  function markIdentityVerified(): void {
    localStorage.setItem('attestto-identity-verified', '1')
    identityVerifiedFlag.value = true
  }

  /**
   * One-shot bootstrap for users who verified before the flag-based mechanism
   * existed: scan the unlocked vault for any cédula credential and flip the
   * flag. Safe to call repeatedly; cheap when the flag is already set.
   */
  async function bootstrapIdentityFlag(): Promise<void> {
    if (identityVerifiedFlag.value) return
    if (!api) return
    try {
      const contents = await api.read()
      const creds = contents?.credentials ?? []
      const hasCedula = creds.some((c: any) =>
        // New W3C shape
        c?.credentialSubject?.cedula ||
        // Old flat shape
        (c?.data?.cedula && c?.data?.tseValidated) ||
        // Type-only check as last resort
        (Array.isArray(c?.type) && c.type.includes('CedulaIdentityCredential'))
      )
      if (hasCedula) markIdentityVerified()
    } catch (err) {
      console.warn('[vault] bootstrapIdentityFlag failed:', err)
    }
  }

  // ── API ────────────────────────────────────────────

  const api = window.presenciaAPI?.vault
  const guardianApi = window.presenciaAPI?.guardian

  async function refreshStatus(): Promise<void> {
    if (!api) return
    try {
      status.value = await api.status()
    } catch (err) {
      error.value = String(err)
    }
  }

  async function create(_passphrase?: string): Promise<string | null> {
    if (!api) return null
    loading.value = true
    error.value = null
    try {
      const result = await api.create({ passphrase: '' })
      await refreshStatus()
      await loadContents()
      return result.did
    } catch (err) {
      error.value = String(err)
      return null
    } finally {
      loading.value = false
    }
  }

  async function unlock(_passphrase?: string): Promise<boolean> {
    if (!api) return false
    loading.value = true
    error.value = null
    try {
      const success = await api.unlock({ passphrase: '' })
      if (success) {
        await refreshStatus()
        await loadContents()
      } else {
        error.value = 'No se pudo desbloquear — intenta de nuevo'
      }
      return success
    } catch (err) {
      error.value = String(err)
      return false
    } finally {
      loading.value = false
    }
  }

  async function lock(): Promise<void> {
    if (!api) return
    await api.lock()
    await refreshStatus()
  }

  async function loadContents(): Promise<void> {
    if (!api) return
    const contents = await api.read()
    if (contents) {
      settings.value = contents.settings
      guardians.value = contents.guardians
    }
  }

  // ── Firma Digital level ────────────────────────────
  // Tracks PDF signing tier. 'self-attested' is the default after KYC.
  // 'firma-digital-mocked' is the DEMO upgrade — never to be confused with
  // a real Nivel A+ signature. ATT-340 will replace the mock with PKCS#11.
  const firmaDigitalLevel = computed(() => settings.value.firmaDigitalLevel ?? 'self-attested')

  async function upgradeFirmaDigitalMock(): Promise<void> {
    await writeSettings({ firmaDigitalLevel: 'firma-digital-mocked' })
  }

  async function writeSettings(s: Partial<VaultSettings>): Promise<void> {
    if (!api) return
    settings.value = { ...settings.value, ...s }
    await api.write({ settings: settings.value })
  }

  async function writePersona(persona: Partial<VaultContents['persona']>): Promise<void> {
    if (!api) return
    await api.write({ persona } as Partial<VaultContents>)
  }

  // ── Guardian Actions ───────────────────────────────

  async function setupGuardians(dids: [string, string, string]): Promise<void> {
    if (!guardianApi) return
    error.value = null
    try {
      await guardianApi.setup({ guardianDids: dids })
      guardians.value = {
        ...guardians.value,
        configured: true,
        guardianDids: dids,
      }
    } catch (err) {
      error.value = String(err)
    }
  }

  async function backup(): Promise<GuardianBackupResult | null> {
    if (!guardianApi) return null
    error.value = null
    try {
      const result = await guardianApi.backup()
      guardians.value = {
        ...guardians.value,
        lastBackupAt: Date.now(),
        backupVersion: result.version,
      }
      return result
    } catch (err) {
      error.value = String(err)
      return null
    }
  }

  async function recover(
    passphrase: string,
    userDid: string,
    guardianDids: string[],
  ): Promise<boolean> {
    if (!guardianApi) return false
    loading.value = true
    error.value = null
    try {
      const success = await guardianApi.recover({ passphrase, userDid, guardianDids })
      if (success) {
        await refreshStatus()
        await loadContents()
      }
      return success
    } catch (err) {
      error.value = String(err)
      return false
    } finally {
      loading.value = false
    }
  }

  // ── Auto-lock Listener ─────────────────────────────

  if (api) {
    api.onLocked(() => {
      status.value = { ...status.value, unlocked: false, did: null }
    })
  }

  return {
    // State
    status,
    settings,
    guardians,
    error,
    loading,
    // Computed
    isUnlocked,
    vaultExists,
    did,
    guardiansConfigured,
    identityVerified,
    firmaDigitalLevel,
    // Actions
    upgradeFirmaDigitalMock,
    markIdentityVerified,
    bootstrapIdentityFlag,
    refreshStatus,
    create,
    unlock,
    lock,
    loadContents,
    writeSettings,
    writePersona,
    setupGuardians,
    backup,
    recover,
  }
})
