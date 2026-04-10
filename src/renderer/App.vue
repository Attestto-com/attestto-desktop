<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Dark } from 'quasar'
import { usePersonaStore } from './stores/persona'
import { useMeshStore } from './stores/mesh'
import { useVaultStore } from './stores/vault'

const route = useRoute()
const router = useRouter()
const persona = usePersonaStore()
const mesh = useMeshStore()
const vault = useVaultStore()

// On mount: check vault status, redirect if locked
onMounted(async () => {
  await vault.refreshStatus()
  if (!vault.isUnlocked && route.meta.skipGuards !== true) {
    router.replace('/unlock')
  }

  mesh.refreshStatus()
  setInterval(() => mesh.refreshStatus(), 15_000)
})

// Redirect to unlock when vault locks (guard only runs on navigation, not on state change)
watch(() => vault.isUnlocked, (unlocked) => {
  if (!unlocked && route.meta.skipGuards !== true) {
    router.replace('/unlock')
  }
})

// ── Breadcrumb trail ──
// Single source of truth mapping a route path → hierarchy of crumbs.
// Each crumb has a label and (optionally) a path to navigate to.
interface Crumb { label: string; path?: string }
const ROUTE_CRUMBS: Record<string, Crumb[]> = {
  '/settings': [{ label: 'Mi cuenta' }],
  '/identity': [{ label: 'Mi cuenta', path: '/settings' }, { label: 'Verificacion de identidad' }],
  '/credentials': [{ label: 'Mi cuenta', path: '/settings' }, { label: 'Credenciales' }],
  '/verify/cr/cedula': [
    { label: 'Mi cuenta', path: '/settings' },
    { label: 'Verificacion de identidad', path: '/identity' },
    { label: 'Cedula de identidad' },
  ],
  '/verify/cr/dimex': [
    { label: 'Mi cuenta', path: '/settings' },
    { label: 'Verificacion de identidad', path: '/identity' },
    { label: 'DIMEX' },
  ],
  '/exam': [{ label: 'Mi cuenta', path: '/settings' }, { label: 'Examen' }],
  '/explore': [{ label: 'Mi cuenta', path: '/settings' }, { label: 'Explorar modulos' }],
  '/session': [{ label: 'Mi cuenta', path: '/settings' }, { label: 'Sesion' }],
  '/audit': [{ label: 'Mi cuenta', path: '/settings' }, { label: 'Auditoria' }],
  '/notary-demo': [{ label: 'Mi cuenta', path: '/settings' }, { label: 'Demo notarial' }],
  '/pdf': [{ label: 'Visor PDF' }],
}
const crumbs = computed<Crumb[]>(() => ROUTE_CRUMBS[route.path] ?? [])

const currentTab = computed(() => {
  const path = route.path
  const match = persona.activeSectorTabs.find(s => s.route === path)
  if (match) return match.route
  if (path.startsWith('/identity') || path === '/credentials') return '/identity'
  if (path === '/session' || path === '/exam') return '/exam'
  if (path === '/notary-demo') return '/notary-demo'
  return '/'
})

const shortDid = computed(() => {
  if (!vault.did) return null
  const d = vault.did
  return d.length > 30 ? d.slice(0, 16) + '...' + d.slice(-8) : d
})

function navigateTab(tabRoute: string) {
  router.push(tabRoute)
}

async function lockAndRedirect() {
  await vault.lock()
  router.replace('/unlock')
}

function toggleTheme() {
  Dark.toggle()
}
</script>

<template>
  <q-layout view="hHh lpr lFf">
    <!-- Titlebar drag region (macOS traffic lights) -->
    <div class="titlebar-drag" />

    <!-- Main header — single row: tabs left, controls + identity right -->
    <q-header class="app-header">
      <div class="header-content">
        <!-- Sector tabs — only when vault is unlocked -->
        <div class="header-left">
          <!-- Locked: show logo + unlock button -->
          <div v-if="!vault.isUnlocked" class="sector-tabs">
            <button class="sector-tab" @click="$router.push('/unlock')">
              <q-icon name="lock" size="18px" />
              <span class="sector-tab__label">Desbloquear</span>
            </button>
            <button class="sector-tab" @click="$router.push('/pdf')">
              <q-icon name="picture_as_pdf" size="18px" />
              <span class="sector-tab__label">Visor PDF</span>
            </button>
          </div>
          <div v-else class="sector-tabs">
            <button
              v-for="tab in persona.activeSectorTabs"
              :key="tab.route"
              class="sector-tab"
              :class="{ 'sector-tab--active': currentTab === tab.route }"
              @click="navigateTab(tab.route)"
            >
              <q-icon :name="tab.icon" size="18px" />
              <span class="sector-tab__label">{{ tab.label }}</span>
              <q-badge
                v-if="tab.badge"
                color="primary"
                :label="tab.badge"
                class="sector-tab__badge"
              />
            </button>

            <button
              v-if="persona.availableModules.length > 0"
              class="sector-tab sector-tab--more"
              @click="$router.push('/explore')"
            >
              <q-icon name="add_circle_outline" size="18px" />
              <span class="sector-tab__label">Mas</span>
              <q-tooltip>Explorar modulos</q-tooltip>
            </button>
          </div>
        </div>

        <div class="header-right">
          <!-- Controls only when unlocked -->
          <template v-if="vault.isUnlocked">
            <!-- Mesh peer count moved to Mi cuenta → Aplicación -->

            <!-- Theme toggle -->
            <q-btn
              flat dense round
              :icon="Dark.isActive ? 'light_mode' : 'dark_mode'"
              size="sm"
              @click="toggleTheme"
            >
              <q-tooltip>{{ Dark.isActive ? 'Modo claro' : 'Modo oscuro' }}</q-tooltip>
            </q-btn>

            <q-btn flat dense round icon="settings" size="sm" @click="$router.push('/settings')">
              <q-tooltip>Configuracion</q-tooltip>
            </q-btn>
          </template>

          <!-- Identity dropdown — always visible, content adapts to vault state -->
          <q-btn-dropdown
            flat
            no-caps
            class="identity-dropdown-btn"
            :class="{ 'identity-dropdown-btn--empty': !vault.did }"
            dropdown-icon="expand_more"
          >
            <template #label>
              <div class="identity-dropdown-label">
                <template v-if="vault.did">
                  <div class="identity-card__avatar identity-card__avatar--sm">
                    <span class="identity-card__mark">tt</span>
                  </div>
                  <span class="identity-dropdown-label__did">Mi cuenta</span>
                </template>
                <template v-else>
                  <q-icon name="lock" size="18px" />
                  <span>Mi boveda</span>
                </template>
              </div>
            </template>

            <q-list class="identity-dropdown-menu" style="min-width: 280px;">
              <!-- Unlocked — active identity -->
              <template v-if="vault.did">
                <q-item class="identity-dropdown-card">
                  <q-item-section avatar>
                    <div class="identity-card__avatar">
                      <span class="identity-card__mark">tt</span>
                    </div>
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-bold">Mi cuenta</q-item-label>
                    <q-item-label caption>
                      <q-icon name="circle" size="8px" color="positive" class="q-mr-xs" />
                      Boveda activa
                    </q-item-label>
                  </q-item-section>
                </q-item>

                <q-separator />

                <q-item clickable v-close-popup @click="$router.push('/identity')">
                  <q-item-section avatar>
                    <q-icon name="badge" size="20px" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>Ver identidad</q-item-label>
                  </q-item-section>
                </q-item>

                <q-item clickable v-close-popup @click="$router.push('/credentials')">
                  <q-item-section avatar>
                    <q-icon name="verified" size="20px" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>Credenciales</q-item-label>
                  </q-item-section>
                </q-item>

                <q-item clickable disabled>
                  <q-item-section avatar>
                    <q-icon name="add_circle_outline" size="20px" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>Vincular ID externa</q-item-label>
                    <q-item-label caption>Proximamente</q-item-label>
                  </q-item-section>
                </q-item>

                <q-separator />

                <q-item clickable v-close-popup @click="lockAndRedirect">
                  <q-item-section avatar>
                    <q-icon name="lock" size="20px" color="negative" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-negative">Bloquear boveda</q-item-label>
                  </q-item-section>
                </q-item>
              </template>

              <!-- Locked — vault exists but needs unlock -->
              <template v-else-if="vault.vaultExists">
                <q-item clickable v-close-popup @click="$router.push('/unlock')">
                  <q-item-section avatar>
                    <q-icon name="fingerprint" size="24px" color="primary" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-bold">Desbloquear boveda</q-item-label>
                    <q-item-label caption>Usa biometrico para acceder</q-item-label>
                  </q-item-section>
                </q-item>
              </template>

              <!-- No vault yet -->
              <template v-else>
                <q-item clickable v-close-popup @click="$router.push('/unlock')">
                  <q-item-section avatar>
                    <q-icon name="lock" size="24px" color="primary" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-bold">Crear boveda segura</q-item-label>
                    <q-item-label caption>Protegida por tu dispositivo</q-item-label>
                  </q-item-section>
                </q-item>

                <q-item clickable v-close-popup @click="$router.push('/recovery')">
                  <q-item-section avatar>
                    <q-icon name="restore" size="20px" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>Recuperar cuenta</q-item-label>
                  </q-item-section>
                </q-item>
              </template>
            </q-list>
          </q-btn-dropdown>
        </div>
      </div>

    </q-header>

    <q-page-container>
      <!-- Breadcrumb trail — only when unlocked and route has crumbs defined -->
      <div v-if="vault.isUnlocked && crumbs.length > 0" class="app-breadcrumbs">
        <q-btn
          v-if="crumbs.length > 1"
          flat dense round
          icon="arrow_back"
          size="sm"
          @click="router.back()"
        >
          <q-tooltip>Atras</q-tooltip>
        </q-btn>
        <template v-for="(crumb, i) in crumbs" :key="i">
          <q-icon v-if="i > 0" name="chevron_right" size="14px" class="app-breadcrumbs__sep" />
          <a
            v-if="crumb.path && i < crumbs.length - 1"
            class="app-breadcrumbs__link"
            @click.prevent="router.push(crumb.path!)"
          >{{ crumb.label }}</a>
          <span v-else class="app-breadcrumbs__current">{{ crumb.label }}</span>
        </template>
      </div>
      <router-view />
    </q-page-container>

    <!-- Bottom status bar -->
    <q-footer class="app-footer">
      <div class="footer-content">
        <div class="footer-left">
          <a class="footer-brand" href="https://attestto.org/ark" target="_blank">
            <span class="footer-brand__mark">tt</span>
            <span>Powered by Attestto Open Ark</span>
          </a>
        </div>
        <div class="footer-right">
          <q-icon name="lock" size="11px" :color="vault.isUnlocked ? 'positive' : 'grey-6'" />
          <span>{{ vault.isUnlocked ? 'Segura' : 'Bloqueada' }}</span>
          <span class="footer-separator">|</span>
          <span>v0.1.0</span>
        </div>
      </div>
    </q-footer>
  </q-layout>
</template>
