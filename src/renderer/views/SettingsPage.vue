<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Dark } from 'quasar'
import { useVaultStore } from '../stores/vault'
import { useMeshStore } from '../stores/mesh'
import JourneySteps from '../components/home/JourneySteps.vue'
import FirmaDigitalUpgradeWizard from '../components/FirmaDigitalUpgradeWizard.vue'

const showFirmaDigitalWizard = ref(false)
const mesh = useMeshStore()


const router = useRouter()
const vault = useVaultStore()

onMounted(async () => {
  // Detect existing cédula credential and flip the journey flag — covers
  // users who verified before the flag mechanism was added.
  void vault.bootstrapIdentityFlag()
  await loadIdentityHandle()
})

// ── User-facing identity handle ──
// Auto-derived from the verified cédula. Two forms, both Attestto-owned:
//   Web2: cr-<cedula>.attestto.id
//   Web3: <cedula>.cr.attestto.sol  (recorded as alsoKnownAs)
// Human-readable handles like `eduardochongkan.attestto.id` are reserved via
// the browser extension — see the CTA below.
const userCedula = ref<string | null>(null)
const userName = ref<string | null>(null)
const showTechnicalDetails = ref(false)

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)([a-záéíóúñ])/g, (_, sp, ch) => sp + ch.toUpperCase())
}

const handleWeb = computed(() => {
  if (!userCedula.value) return null
  const clean = userCedula.value.replace(/[^0-9]/g, '')
  return `cr-${clean}.attestto.id`
})

const handleSns = computed(() => {
  if (!userCedula.value) return null
  const clean = userCedula.value.replace(/[^0-9]/g, '')
  return `${clean}.cr.attestto.sol`
})

async function loadIdentityHandle(): Promise<void> {
  const api = window.presenciaAPI?.vault
  if (!api) return
  try {
    const contents = await api.read()
    for (const c of contents?.credentials ?? []) {
      const cedula =
        (c as any)?.credentialSubject?.cedula ??
        (c as any)?.data?.cedula
      const nombre =
        (c as any)?.credentialSubject?.nombre ??
        (c as any)?.data?.nombre
      if (cedula) {
        userCedula.value = cedula
        if (nombre) userName.value = titleCase(String(nombre).trim())
        return
      }
    }
  } catch (err) {
    console.warn('[settings] could not load cédula from vault:', err)
  }
}

function openExtensionInstall(): void {
  // window.open is intercepted by main process setWindowOpenHandler →
  // shell.openExternal, so this opens in the user's default browser.
  window.open('https://attestto.com/extension', '_blank')
}

function openArk(): void {
  window.open('https://attestto.org/ark', '_blank')
}

async function copyHandle(handle: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(handle)
  } catch { /* ignore */ }
}

// ── Font size (accessibility) ──
// Default index aligns with the html { font-size: 19px } base in app.scss.
const FONT_SIZES = [15, 17, 19, 21, 23]
const fontSizeIndex = ref(2)
const currentFontSize = computed(() => FONT_SIZES[fontSizeIndex.value])

function increaseFontSize() {
  if (fontSizeIndex.value < FONT_SIZES.length - 1) {
    fontSizeIndex.value++
    document.documentElement.style.fontSize = `${FONT_SIZES[fontSizeIndex.value]}px`
  }
}

function decreaseFontSize() {
  if (fontSizeIndex.value > 0) {
    fontSizeIndex.value--
    document.documentElement.style.fontSize = `${FONT_SIZES[fontSizeIndex.value]}px`
  }
}

// ── Settings ──

const language = computed({
  get: () => vault.settings.language,
  set: (v: string) => vault.writeSettings({ language: v as 'es' | 'en' }),
})

const themeMode = computed({
  get: () => Dark.isActive ? 'dark' : 'light',
  set: (v: string) => Dark.set(v === 'dark'),
})

async function lockVault() {
  await vault.lock()
  router.replace('/unlock')
}

function timeAgo(ts?: number): string {
  if (!ts) return 'Nunca'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Hace un momento'
  if (mins < 60) return `Hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `Hace ${days} dia${days > 1 ? 's' : ''}`
}

// ── Profile completion ──
// Guardians are NOT a required onboarding step — they're surfaced as a
// persistent warning in the Seguridad card instead. The onboarding bar only
// reflects the two real steps: vault + identity verified.
const profileItems = computed(() => {
  const items = [
    { label: 'Boveda creada', done: vault.vaultExists },
    { label: 'Identidad verificada', done: vault.identityVerified },
  ]
  return items
})

const profileCompletion = computed(() => {
  const done = profileItems.value.filter(i => i.done).length
  return Math.round((done / profileItems.value.length) * 100)
})

const profileComplete = computed(() => profileItems.value.every(i => i.done))
</script>

<template>
  <q-page class="settings-page">
    <!-- Onboarding journey — only when profile incomplete -->
    <JourneySteps v-if="!profileComplete" class="q-mb-lg" />

    <!-- Header -->
    <div class="settings-header">
      <div>
        <div class="settings-header__title-row">
          <h1 class="settings-title">Mi cuenta</h1>
          <q-badge
            v-if="profileComplete"
            color="positive"
            class="profile-ready-badge"
          >
            <q-icon name="verified" size="14px" class="q-mr-xs" />
            Perfil listo
          </q-badge>
        </div>
        <p class="settings-subtitle">Administra tu identidad, seguridad y preferencias</p>
      </div>
      <div v-if="!profileComplete" class="profile-completion">
        <q-circular-progress
          :value="profileCompletion"
          size="56px"
          :thickness="0.2"
          color="primary"
          track-color="grey-8"
          class="q-mr-sm"
        >
          <span class="completion-text">{{ profileCompletion }}%</span>
        </q-circular-progress>
        <div>
          <div class="text-weight-bold">Perfil completo</div>
          <div class="att-text-muted">
            {{ profileItems.filter(i => i.done).length }}/{{ profileItems.length }} items
          </div>
        </div>
      </div>
    </div>

    <div class="settings-grid">
      <!-- ════════════════════ LEFT COLUMN ════════════════════ -->
      <div class="settings-col">

        <!-- Identity Card -->
        <div class="settings-card">
          <div class="card-header">
            <span class="card-title">Identidad</span>
          </div>

          <div class="identity-profile">
            <div class="identity-avatar">
              <span class="identity-avatar__mark">tt</span>
            </div>
            <div class="identity-info">
              <div class="identity-info__handle-row">
                <span class="identity-info__handle">
                  {{ userName || (vault.did ? 'Identidad activa' : 'Sin verificar') }}
                </span>
                <q-badge
                  v-if="vault.identityVerified"
                  color="positive"
                  class="identity-verified-badge"
                >
                  <q-icon name="verified" size="12px" class="q-mr-xs" />
                  Verificada
                </q-badge>
              </div>
              <div v-if="handleWeb" class="identity-info__sub-handle">
                {{ handleWeb }}
              </div>
              <div class="att-text-muted" style="margin-top: 0.25rem;">
                <q-icon
                  :name="vault.did ? 'circle' : 'warning'"
                  :color="vault.did ? 'positive' : 'warning'"
                  size="8px"
                  class="q-mr-xs"
                />
                {{ vault.did ? 'Boveda protegida por tu dispositivo' : 'Completa la verificacion de identidad' }}
              </div>

              <!-- Technical details (collapsed by default) -->
              <div v-if="handleSns || vault.did" class="identity-info__technical">
                <a
                  class="identity-info__toggle"
                  @click="showTechnicalDetails = !showTechnicalDetails"
                >
                  {{ showTechnicalDetails ? '▾' : '▸' }} Detalles técnicos
                </a>
                <div v-if="showTechnicalDetails" class="identity-info__did-list">
                  <div v-if="handleWeb" class="identity-info__did" @click="copyHandle(handleWeb)">
                    <q-icon name="public" size="12px" />
                    <code>did:web:attestto.id:cr-{{ userCedula?.replace(/[^0-9]/g, '') }}</code>
                  </div>
                  <div v-if="handleSns" class="identity-info__did" @click="copyHandle(handleSns)">
                    <q-icon name="hub" size="12px" />
                    <code>did:sns:{{ handleSns }}</code>
                  </div>
                  <div v-if="vault.did" class="identity-info__did" @click="copyHandle(vault.did!)">
                    <q-icon name="key" size="12px" />
                    <code>{{ vault.did }}</code>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Reserve human-readable handle CTA — extension not published yet -->
          <div v-if="vault.identityVerified" class="claim-handle-cta">
            <div class="claim-handle-cta__body">
              <q-icon name="extension" size="18px" color="primary" />
              <div>
                <div class="claim-handle-cta__title">Próximamente: nombre humano e inicio de sesión web</div>
                <div class="claim-handle-cta__text">
                  Pronto vas a poder reservar <code>tunombre.attestto.id</code> y usar tus credenciales
                  para iniciar sesión y presentarlas en sitios web a través de la extensión Attestto.
                </div>
              </div>
            </div>
            <q-btn
              color="primary"
              icon="schedule"
              label="Próximamente"
              size="sm"
              unelevated
              disable
            />
          </div>

          <!-- Firma Digital upgrade CTA — only after KYC -->
          <div v-if="vault.identityVerified" class="firma-upgrade-cta">
            <div class="firma-upgrade-cta__body">
              <q-icon name="badge" size="20px" color="primary" />
              <div>
                <div class="firma-upgrade-cta__title">
                  <template v-if="vault.firmaDigitalLevel === 'firma-digital-mocked'">
                    Firma Digital activa
                  </template>
                  <template v-else>
                    Mejorá tu firma a Firma Digital legal
                  </template>
                  <q-badge
                    :color="vault.firmaDigitalLevel === 'firma-digital-mocked' ? 'positive' : 'primary'"
                    class="q-ml-sm"
                  >
                    {{ vault.firmaDigitalLevel === 'firma-digital-mocked' ? 'Nivel A+' : 'Nivel B' }}
                  </q-badge>
                  <q-badge
                    v-if="vault.firmaDigitalLevel === 'firma-digital-mocked'"
                    color="orange"
                    class="q-ml-xs"
                  >
                    DEMO
                  </q-badge>
                </div>
                <div class="firma-upgrade-cta__text">
                  <template v-if="vault.firmaDigitalLevel === 'firma-digital-mocked'">
                    Tus firmas se marcan como <code>firma-digital-mocked</code>.
                    Reemplazo real con PKCS#11 en ATT-340.
                  </template>
                  <template v-else>
                    Pasá de firma auto-atestada (Nivel B) a Firma Digital legal (Nivel A+)
                    usando tu tarjeta y PIN.
                  </template>
                </div>
              </div>
            </div>
            <q-btn
              v-if="vault.firmaDigitalLevel !== 'firma-digital-mocked'"
              color="blue-6"
              text-color="white"
              icon="upgrade"
              label="Mejorar"
              size="sm"
              unelevated
              @click="showFirmaDigitalWizard = true"
            />
          </div>

          <q-separator class="q-my-md" color="grey-9" />

          <q-list dense class="settings-list">
            <q-item clickable @click="$router.push('/identity')">
              <q-item-section avatar>
                <q-icon name="badge" size="20px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Verificacion de identidad</q-item-label>
                <q-item-label caption>
                  {{ vault.did ? 'Ver credenciales verificadas' : 'Verificar tu identidad' }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="chevron_right" color="grey-6" />
              </q-item-section>
            </q-item>

            <q-item clickable @click="$router.push('/credentials')">
              <q-item-section avatar>
                <q-icon name="verified" size="20px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Credenciales</q-item-label>
                <q-item-label caption>Pruebas verificables en tu boveda</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="chevron_right" color="grey-6" />
              </q-item-section>
            </q-item>

            <q-item clickable disabled>
              <q-item-section avatar>
                <q-icon name="link" size="20px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Cuentas vinculadas</q-item-label>
                <q-item-label caption>Proximamente</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="chevron_right" color="grey-6" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <!-- Security Card -->
        <div class="settings-card">
          <div class="card-header">
            <span class="card-title">Seguridad</span>
          </div>

          <div class="security-grid">
            <!-- Vault status -->
            <div class="security-item">
              <div class="security-item__icon">
                <q-icon name="lock" :color="vault.isUnlocked ? 'positive' : 'grey-6'" size="24px" />
              </div>
              <div class="security-item__label">Boveda</div>
              <div class="security-item__status">
                <q-badge :color="vault.isUnlocked ? 'positive' : 'grey-7'" :label="vault.isUnlocked ? 'Activa' : 'Bloqueada'" />
              </div>
              <q-btn
                v-if="vault.isUnlocked"
                outline
                dense
                label="Bloquear"
                icon="lock"
                color="grey-5"
                size="sm"
                class="q-mt-sm security-item__action"
                @click="lockVault"
              />
            </div>

            <!-- Encryption -->
            <div class="security-item">
              <div class="security-item__icon">
                <q-icon name="verified_user" color="positive" size="24px" />
              </div>
              <div class="security-item__label">Cifrado</div>
              <div class="security-item__status">
                <q-badge color="positive" label="Activo" />
              </div>
              <div class="att-text-muted" style="margin-top: 4px;">
                xsalsa20-poly1305
              </div>
            </div>

            <!-- Auto-lock -->
            <div class="security-item">
              <div class="security-item__icon">
                <q-icon name="timer" color="info" size="24px" />
              </div>
              <div class="security-item__label">Auto-bloqueo</div>
              <div class="security-item__status">
                <q-badge color="info" label="5 min" />
              </div>
            </div>
          </div>

          <q-separator class="q-my-md" color="grey-9" />

          <!-- Guardians -->
          <div class="card-header q-mb-sm">
            <span class="card-title">Guardianes de recuperacion</span>
          </div>

          <template v-if="vault.guardiansConfigured">
            <div class="guardian-status">
              <q-icon name="check_circle" color="positive" size="20px" class="q-mr-sm" />
              <div>
                <div class="text-weight-medium">{{ vault.guardians.guardianDids.length }} guardianes activos</div>
                <div class="att-text-muted">
                  Ultimo respaldo: {{ timeAgo(vault.guardians.lastBackupAt) }}
                </div>
              </div>
            </div>
            <div class="q-mt-sm" style="display: flex; gap: 8px;">
              <q-btn
                flat dense
                label="Respaldar ahora"
                icon="backup"
                color="primary"
                size="sm"
                @click="vault.backup()"
              />
              <q-btn
                flat dense
                label="Administrar"
                icon="settings"
                color="grey-6"
                size="sm"
                to="/guardian-setup"
              />
            </div>
          </template>

          <template v-else>
            <div class="guardian-status guardian-status--warning">
              <q-icon name="warning" color="warning" size="20px" class="q-mr-sm" />
              <div>
                <div class="text-weight-medium">Sin guardianes</div>
                <div class="att-text-muted">
                  Sin recuperacion si pierdes tu dispositivo
                </div>
              </div>
            </div>
            <q-btn
              flat dense
              label="Configurar guardianes"
              icon="shield"
              color="warning"
              size="sm"
              class="q-mt-sm"
              to="/guardian-setup"
            />
          </template>
        </div>
      </div>

      <!-- ════════════════════ RIGHT COLUMN ════════════════════ -->
      <div class="settings-col">

        <!-- Preferences Card -->
        <div class="settings-card">
          <div class="card-header">
            <span class="card-title">Preferencias</span>
          </div>

          <q-list dense class="settings-list">
            <!-- Theme -->
            <q-item>
              <q-item-section avatar>
                <q-icon :name="Dark.isActive ? 'dark_mode' : 'light_mode'" size="20px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Tema</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn-toggle
                  v-model="themeMode"
                  no-caps dense unelevated
                  toggle-color="primary"
                  :options="[
                    { label: 'Oscuro', value: 'dark' },
                    { label: 'Claro', value: 'light' },
                  ]"
                  class="theme-toggle"
                />
              </q-item-section>
            </q-item>

            <!-- Language -->
            <q-item>
              <q-item-section avatar>
                <q-icon name="translate" size="20px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Idioma</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-select
                  v-model="language"
                  :options="[
                    { label: 'Espanol', value: 'es' },
                    { label: 'English', value: 'en' },
                  ]"
                  emit-value map-options
                  dense outlined
                  style="min-width: 140px;"
                />
              </q-item-section>
            </q-item>

            <!-- Font size -->
            <q-item>
              <q-item-section avatar>
                <q-icon name="format_size" size="20px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Tamano de texto</q-item-label>
                <q-item-label caption>{{ currentFontSize }}px</q-item-label>
              </q-item-section>
              <q-item-section side>
                <div style="display: flex; gap: 4px; align-items: center;">
                  <q-btn
                    flat dense round
                    icon="remove"
                    size="sm"
                    :disable="fontSizeIndex <= 0"
                    @click="decreaseFontSize"
                  />
                  <span class="text-weight-bold" style="min-width: 32px; text-align: center;">
                    {{ currentFontSize }}
                  </span>
                  <q-btn
                    flat dense round
                    icon="add"
                    size="sm"
                    :disable="fontSizeIndex >= FONT_SIZES.length - 1"
                    @click="increaseFontSize"
                  />
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <!-- Application Card -->
        <div class="settings-card">
          <div class="card-header">
            <span class="card-title">Aplicacion</span>
          </div>

          <q-list dense class="settings-list">
            <!-- Mesh peer count -->
            <q-item>
              <q-item-section avatar>
                <q-icon name="hub" size="20px" :color="mesh.isRunning ? 'positive' : 'grey-6'" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Malla P2P</q-item-label>
                <q-item-label caption>
                  {{ mesh.isRunning
                     ? `${mesh.peerCount + 1} nodo${mesh.peerCount + 1 === 1 ? '' : 's'} conectados (incluye este)`
                     : 'Desconectado' }}
                  ·
                  <a class="ark-inline-link" @click="openArk">Attestto Ark</a>
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge
                  :color="mesh.isRunning ? 'positive' : 'grey-7'"
                  :label="mesh.isRunning ? String(mesh.peerCount + 1) : '0'"
                />
              </q-item-section>
            </q-item>


            <!-- Camera -->
            <q-item>
              <q-item-section avatar>
                <q-icon name="videocam" size="20px" />
              </q-item-section>
              <q-item-section>
                <q-item-label>Camara</q-item-label>
                <q-item-label caption>Captura de video</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-btn flat dense label="Detectar" color="primary" size="sm" />
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <!-- About Card -->
        <div class="settings-card settings-card--muted">
          <div class="ark-brand" @click="openArk">
            <div class="ark-brand__title">
              Attestto Ark
              <q-icon name="open_in_new" size="12px" class="q-ml-xs" />
            </div>
            <div class="ark-brand__tagline">
              Arquitectura soberana de identidad — bóveda, malla, ceremonia, anclaje
            </div>
            <div class="ark-brand__url">attestto.org/ark</div>
          </div>

          <q-separator class="q-my-sm" color="grey-9" />

          <div class="about-row">
            <span class="att-text-muted">Version</span>
            <span>v0.1.0</span>
          </div>
          <div class="about-row">
            <span class="att-text-muted">Motor</span>
            <span>Electron + Vue 3</span>
          </div>
          <div class="about-row">
            <span class="att-text-muted">Cifrado</span>
            <span>xsalsa20-poly1305 + scrypt</span>
          </div>
          <div class="about-row" style="border: none;">
            <span class="att-text-muted">Recuperacion</span>
            <span>Shamir 2-of-3</span>
          </div>
        </div>
      </div>
    </div>

    <FirmaDigitalUpgradeWizard v-model="showFirmaDigitalWizard" />
  </q-page>
</template>

<style scoped lang="scss">
.settings-page {
  padding: 2rem 2.5rem;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;

  &__title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
}

.profile-ready-badge {
  font-size: 0.95rem;
  padding: 0.35rem 0.6rem;
  font-weight: 600;
}

.settings-title {
  font-size: var(--att-text-2xl);
  font-weight: 700;
  margin: 0 0 0.25rem 0;
}

.settings-subtitle {
  font-size: var(--att-text-sm);
  opacity: 0.6;
  margin: 0;
}

.profile-completion {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.completion-text {
  font-size: var(--att-text-sm);
  font-weight: 700;
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  align-items: start;
}

.settings-col {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.settings-card {
  background: var(--att-bg-card, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--att-border);
  border-radius: 0.75rem;
  padding: 1.25rem;
}

.settings-card--muted {
  background: rgba(255, 255, 255, 0.02);
  padding: 1rem 1.25rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.card-title {
  font-size: var(--att-text-lg);
  font-weight: 600;
}

.identity-profile {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.identity-info {
  flex: 1;
  min-width: 0;

  &__handle-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  &__handle {
    font-size: 1rem;
    font-weight: 700;
    color: var(--att-text-title, #e2e8f0);
    word-break: break-all;
  }

  &__sub-handle {
    font-family: ui-monospace, monospace;
    font-size: 0.95rem;
    color: var(--q-primary);
    word-break: break-all;
  }

  &__technical {
    margin-top: 0.5rem;
    font-size: 0.9rem;
  }

  &__toggle {
    color: var(--att-text-muted);
    cursor: pointer;
    user-select: none;
    &:hover { color: var(--q-primary); }
  }

  &__did-list {
    margin-top: 0.375rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  &__did {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--att-text-muted);
    cursor: pointer;
    word-break: break-all;
    code {
      font-size: 0.9rem;
      font-family: ui-monospace, monospace;
    }
    &:hover { color: var(--q-primary); }
  }
}

.identity-verified-badge {
  font-size: 0.9rem;
  padding: 0.25rem 0.45rem;
}

.claim-handle-cta {
  margin-top: 1rem;
  padding: 0.875rem 1rem;
  border: 1px dashed rgba(34, 211, 168, 0.35);
  border-radius: 0.625rem;
  background: rgba(34, 211, 168, 0.04);
  display: flex;
  align-items: center;
  gap: 0.875rem;
  justify-content: space-between;

  &__body {
    display: flex;
    gap: 0.625rem;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
  }

  &__title {
    font-weight: 600;
    font-size: 1rem;
    color: var(--att-text-title, #e2e8f0);
    margin-bottom: 0.125rem;
  }

  &__text {
    font-size: 0.9rem;
    color: var(--att-text-muted);
    line-height: 1.4;
    code {
      font-family: ui-monospace, monospace;
      font-size: 0.9rem;
      color: var(--q-primary);
    }
  }
}

.firma-upgrade-cta {
  margin-top: 1rem;
  padding: 0.875rem 1rem;
  border: 1px solid rgba(99, 102, 241, 0.35);
  border-radius: 0.625rem;
  background: rgba(99, 102, 241, 0.06);
  display: flex;
  align-items: center;
  gap: 0.875rem;
  justify-content: space-between;

  &__body {
    display: flex;
    gap: 0.625rem;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
  }

  &__title {
    font-weight: 600;
    font-size: 1rem;
    color: var(--att-text-title, #e2e8f0);
    margin-bottom: 0.125rem;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }

  &__text {
    font-size: 0.9rem;
    color: var(--att-text-muted);
    line-height: 1.4;
    code {
      font-family: ui-monospace, monospace;
      font-size: 0.9rem;
      color: var(--q-primary);
    }
  }
}

.identity-avatar {
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 50%;
  background: var(--att-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.identity-avatar__mark {
  font-weight: 800;
  font-size: var(--att-text-lg);
  color: white;
  letter-spacing: 0.5px;
}

.settings-list {
  margin: 0 -0.5rem;

  .q-item {
    border-radius: 0.5rem;
    min-height: 3rem;
    font-size: var(--att-text-md);
  }
}

.security-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.security-item {
  text-align: center;
  padding: 0.75rem 0.5rem;
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
}

.security-item__icon {
  margin-bottom: 0.375rem;
}

.security-item__action {
  font-size: 0.85rem;
  border-radius: 0.5rem;
}

.security-item__label {
  font-size: var(--att-text-xs);
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.guardian-status {
  display: flex;
  align-items: center;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgba(16, 185, 129, 0.08);
}

.guardian-status--warning {
  background: rgba(245, 158, 11, 0.08);
}

.theme-toggle {
  font-size: var(--att-text-xs);
}

.ark-brand {
  cursor: pointer;
  padding: 0.25rem 0 0.5rem;
  user-select: none;

  &__title {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--att-text-title, #e2e8f0);
    display: flex;
    align-items: center;
  }

  &__tagline {
    font-size: 0.9rem;
    color: var(--att-text-muted);
    margin-top: 0.15rem;
    line-height: 1.35;
  }

  &__url {
    font-family: ui-monospace, monospace;
    font-size: 0.9rem;
    color: var(--q-primary, #22d3a8);
    margin-top: 0.25rem;
  }

  &:hover &__title { color: var(--q-primary, #22d3a8); }
}

.ark-inline-link {
  color: var(--q-primary, #22d3a8);
  cursor: pointer;
  text-decoration: none;
  &:hover { text-decoration: underline; }
}

.about-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: var(--att-text-sm);
}

@media (max-width: 900px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
