<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Dark } from 'quasar'
import { usePersonaStore } from './stores/persona'
import { useMeshStore } from './stores/mesh'
import { useVaultStore } from './stores/vault'
// Real brand asset — the violet "tt" logo. Never hand-roll this as text/SVG.
import brandLogo from '../../resources/icon.png'

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

// The unlock screen is self-contained (own brand + actions): hide the nav
// chrome so it reads as a focused entry point.
const isUnlockScreen = computed(() => route.name === 'unlock')

// ── Left sidebar (CORTEX-style) ──
// Rail/expanded collapse via Quasar's mini mode. Persisted across sessions.
const sidebarMini = ref(localStorage.getItem('att.sidebarMini') === '1')
function toggleSidebar() {
  sidebarMini.value = !sidebarMini.value
  localStorage.setItem('att.sidebarMini', sidebarMini.value ? '1' : '0')
}

// Nav grouped into CORTEX-style sections. Sector items are dynamic (driven by
// installed modules); the account/document items are fixed.
interface NavItem { label: string; icon: string; route: string; badge?: string }
interface NavGroup { title?: string; items: NavItem[] }
const navGroups = computed<NavGroup[]>(() => {
  const sectors = persona.activeSectorTabs.filter((t) => t.route !== '/')
  const groups: NavGroup[] = [
    { items: [{ label: 'Inicio', icon: 'dashboard', route: '/' }] },
    {
      title: 'Mi cuenta',
      items: [
        { label: 'Mi cuenta', icon: 'manage_accounts', route: '/settings' },
        { label: 'Verificacion de identidad', icon: 'badge', route: '/identity' },
        { label: 'Credenciales', icon: 'verified', route: '/credentials' },
      ],
    },
    {
      title: 'Documentos',
      items: [
        {
          label: vault.identityVerified ? 'Visor + Firmador PDF' : 'Visor de PDF',
          icon: 'picture_as_pdf',
          route: '/pdf',
        },
      ],
    },
  ]
  if (sectors.length) groups.push({ title: 'Sectores', items: sectors })
  if (persona.availableModules.length) {
    groups.push({ items: [{ label: 'Explorar modulos', icon: 'add_circle_outline', route: '/explore' }] })
  }
  return groups
})

function isNavActive(itemRoute: string): boolean {
  if (itemRoute === '/') return route.path === '/'
  if (itemRoute === '/settings') {
    // Mi cuenta stays highlighted for its detail sub-pages
    return route.path === '/settings'
  }
  return route.path === itemRoute || route.path.startsWith(itemRoute + '/')
}

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
  <q-layout view="lHh LpR lFf">
    <!-- Titlebar drag region (macOS traffic lights) -->
    <div class="titlebar-drag" />

    <!-- Main header — single row: tabs left, controls + identity right -->
    <q-header v-if="!isUnlockScreen" class="app-header">
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
          <!-- Unlocked: primary nav lives in the left sidebar. Header-left
               shows a collapse toggle so the rail can be reopened. -->
          <button
            v-else
            class="sector-tab sector-tab--icon"
            @click="toggleSidebar"
          >
            <q-icon name="menu" size="20px" />
            <q-tooltip>{{ sidebarMini ? 'Expandir menu' : 'Colapsar menu' }}</q-tooltip>
          </button>
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

    <!-- Left sidebar — CORTEX-style, collapsible rail. Only when unlocked. -->
    <q-drawer
      v-if="vault.isUnlocked && !isUnlockScreen"
      :model-value="true"
      :mini="sidebarMini"
      :width="248"
      :mini-width="68"
      side="left"
      bordered
      class="app-sidebar"
    >
      <div class="app-sidebar__inner">
        <!-- Brand -->
        <button class="app-sidebar__brand" @click="$router.push('/')">
          <img :src="brandLogo" alt="Attestto" class="app-sidebar__mark" />
          <span v-if="!sidebarMini" class="app-sidebar__word">
            Attest<span class="app-sidebar__accent">to</span>
          </span>
        </button>

        <!-- Nav -->
        <q-scroll-area class="app-sidebar__nav">
          <template v-for="(group, gi) in navGroups" :key="gi">
            <div v-if="group.title && !sidebarMini" class="app-sidebar__section">
              {{ group.title }}
            </div>
            <q-separator v-else-if="group.title" class="app-sidebar__mini-sep" />
            <q-item
              v-for="item in group.items"
              :key="item.route"
              clickable
              v-ripple
              :active="isNavActive(item.route)"
              active-class="app-nav-item--active"
              class="app-nav-item"
              @click="$router.push(item.route)"
            >
              <q-item-section avatar>
                <q-icon :name="item.icon" size="22px" />
              </q-item-section>
              <q-item-section v-if="!sidebarMini">{{ item.label }}</q-item-section>
              <q-item-section v-if="!sidebarMini && item.badge" side>
                <q-badge color="primary" :label="item.badge" />
              </q-item-section>
              <q-tooltip v-if="sidebarMini" anchor="center right" self="center left">
                {{ item.label }}
              </q-tooltip>
            </q-item>
          </template>
        </q-scroll-area>

        <!-- Footer: lock + collapse toggle -->
        <div class="app-sidebar__foot">
          <q-item clickable v-ripple class="app-nav-item" @click="lockAndRedirect">
            <q-item-section avatar>
              <q-icon name="lock" size="22px" color="negative" />
            </q-item-section>
            <q-item-section v-if="!sidebarMini" class="text-negative">Bloquear boveda</q-item-section>
            <q-tooltip v-if="sidebarMini" anchor="center right" self="center left">Bloquear boveda</q-tooltip>
          </q-item>
          <q-item clickable v-ripple class="app-nav-item" @click="toggleSidebar">
            <q-item-section avatar>
              <q-icon :name="sidebarMini ? 'chevron_right' : 'chevron_left'" size="22px" />
            </q-item-section>
            <q-item-section v-if="!sidebarMini">Colapsar</q-item-section>
          </q-item>
        </div>
      </div>
    </q-drawer>

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
          <a class="footer-brand" href="https://attestto.org" target="_blank">
            <img :src="brandLogo" alt="Attestto" class="footer-brand__mark footer-brand__mark--img" />
            <span>Attestto</span>
          </a>
        </div>
        <div v-if="!isUnlockScreen" class="footer-right">
          <q-icon name="lock" size="11px" :color="vault.isUnlocked ? 'positive' : 'grey-6'" />
          <span>{{ vault.isUnlocked ? 'Segura' : 'Bloqueada' }}</span>
          <span class="footer-separator">|</span>
          <span>v0.1.0</span>
        </div>
      </div>
    </q-footer>
  </q-layout>
</template>
