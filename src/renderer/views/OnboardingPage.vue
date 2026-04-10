<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePersonaStore } from '../stores/persona'
import type { PersonaType } from '../types/module-manifest'
import { CR_CANTONS, CR_PROVINCES } from '../country/cr/cantons'

const router = useRouter()
const persona = usePersonaStore()
const selected = ref<PersonaType | null>(null)
const onboardingStep = ref<'persona' | 'location'>('persona')

// Location selection
const selectedProvince = ref('')
const selectedCanton = ref('')
const detectingLocation = ref(false)

const provinceOptions = Object.entries(CR_PROVINCES).map(([code, name]) => ({ label: name, value: code }))
const cantonOptions = computed(() => {
  if (!selectedProvince.value) return []
  return CR_CANTONS
    .filter(c => c.code[0] === selectedProvince.value)
    .map(c => ({ label: c.name, value: c.code }))
})

const personas = [
  {
    type: 'citizen' as PersonaType,
    title: 'Ciudadano(a)',
    subtitle: 'Tramites personales, examenes, credenciales',
    icon: 'person',
    color: 'primary',
    examples: 'Examen COSEVI, citas medicas, credenciales',
  },
  {
    type: 'legal' as PersonaType,
    title: 'Profesional Legal',
    subtitle: 'Firma de documentos, verificacion, notariado',
    icon: 'gavel',
    color: 'secondary',
    examples: 'Firma PAdES, actos notariales, audiencias',
  },
  {
    type: 'health' as PersonaType,
    title: 'Salud',
    subtitle: 'Citas, expedientes, verificacion de pacientes',
    icon: 'local_hospital',
    color: 'positive',
    examples: 'Citas CCSS, recetas digitales, telemedicina',
  },
  {
    type: 'education' as PersonaType,
    title: 'Estudiante',
    subtitle: 'Examenes, titulos verificables, admision',
    icon: 'school',
    color: 'info',
    examples: 'Examenes proctoreados, titulos como VC',
  },
  {
    type: 'finance' as PersonaType,
    title: 'Finanzas',
    subtitle: 'KYC, compliance, transacciones verificadas',
    icon: 'account_balance_wallet',
    color: 'warning',
    examples: 'KYC/KYB, USDC, treasury multisig',
  },
  {
    type: 'government' as PersonaType,
    title: 'Funcionario(a) Publico',
    subtitle: 'Verificacion de ciudadanos, auditoria, gestion',
    icon: 'account_balance',
    color: 'accent',
    examples: 'Verificacion, auditoria, tramites institucionales',
  },
]

function confirmPersona() {
  if (!selected.value) return
  onboardingStep.value = 'location'
  tryGeolocation()
}

function confirmLocation() {
  if (!selected.value) return
  persona.setPersona(selected.value)

  // Store location in localStorage for Padrón lookup
  if (selectedCanton.value) {
    localStorage.setItem('attestto-canton', selectedCanton.value)
    localStorage.setItem('attestto-province', selectedProvince.value)
  }

  router.replace('/guardian-setup')
}

function skipLocation() {
  if (!selected.value) return
  persona.setPersona(selected.value)
  router.replace('/guardian-setup')
}

function skip() {
  persona.setPersona('citizen')
  router.replace('/guardian-setup')
}

async function tryGeolocation() {
  detectingLocation.value = true
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
    })
    const { latitude, longitude } = pos.coords

    // Map GPS coordinates to nearest CR province
    // CR provinces roughly by latitude/longitude bands
    // This is approximate — good enough for first guess
    if (latitude > 10.3 && longitude > -84.3 && longitude < -83.8) {
      selectedProvince.value = '7' // Limón
    } else if (latitude > 10.3 && longitude < -84.8) {
      selectedProvince.value = '5' // Guanacaste
    } else if (latitude > 10.0 && latitude < 10.3 && longitude < -84.5) {
      selectedProvince.value = '5' // Guanacaste
    } else if (latitude > 9.8 && latitude < 10.1 && longitude > -84.2 && longitude < -83.6) {
      selectedProvince.value = '3' // Cartago
    } else if (latitude > 9.9 && longitude > -84.3 && longitude < -84.0) {
      selectedProvince.value = '1' // San José
    } else if (latitude > 10.0 && longitude > -84.4 && longitude < -84.0) {
      selectedProvince.value = '2' // Alajuela
    } else if (latitude > 10.0 && longitude > -84.2 && longitude < -84.0) {
      selectedProvince.value = '4' // Heredia
    } else if (latitude < 9.5) {
      selectedProvince.value = '6' // Puntarenas (south)
    } else {
      selectedProvince.value = '6' // Puntarenas (default pacific)
    }

    console.log('[onboarding] Geolocation:', latitude, longitude, '→ province', selectedProvince.value)
  } catch {
    console.log('[onboarding] Geolocation not available')
  } finally {
    detectingLocation.value = false
  }
}
</script>

<template>
  <q-page class="onboarding-page">
    <div class="onboarding-container">
      <!-- Logo -->
      <div class="onboarding-brand">
        <span class="brand-mark" style="font-size: 24px;">ATTESTTO</span>
      </div>

      <!-- STEP 1: Persona selection -->
      <template v-if="onboardingStep === 'persona'">
        <h2 class="onboarding-title att-text-title">
          Como vas a usar Attestto?
        </h2>
        <p class="onboarding-subtitle att-text-body">
          Esto personaliza tu pantalla de inicio. Podes cambiar esto despues en Configuracion.
        </p>

        <div class="onboarding-grid">
          <button
            v-for="p in personas"
            :key="p.type"
            class="onboarding-card"
            :class="{ 'onboarding-card--selected': selected === p.type }"
            @click="selected = p.type"
          >
            <div class="onboarding-card__icon">
              <q-icon :name="p.icon" size="32px" :color="selected === p.type ? p.color : 'grey-6'" />
            </div>
            <div class="onboarding-card__content">
              <div class="text-subtitle2 text-weight-bold att-text-title">{{ p.title }}</div>
              <div class="text-caption att-text-body">{{ p.subtitle }}</div>
              <div class="text-caption att-text-disabled q-mt-xs">{{ p.examples }}</div>
            </div>
            <q-icon
              v-if="selected === p.type"
              name="check_circle"
              size="20px"
              color="primary"
              class="onboarding-card__check"
            />
          </button>
        </div>

        <div class="onboarding-actions">
          <q-btn flat color="grey-6" label="Personalizar despues" @click="skip" />
          <q-btn color="primary" label="Continuar" icon-right="arrow_forward" :disable="!selected" @click="confirmPersona" />
        </div>
      </template>

      <!-- STEP 2: Location -->
      <template v-if="onboardingStep === 'location'">
        <h2 class="onboarding-title att-text-title">
          Donde votas?
        </h2>
        <p class="onboarding-subtitle att-text-body">
          Tu domicilio electoral nos ayuda a verificar tu cedula en el Padron del TSE sin descargar todo el pais.
        </p>

        <div v-if="detectingLocation" class="location-detecting q-mb-lg">
          <q-spinner-dots size="24px" color="primary" />
          <span>Detectando ubicacion...</span>
        </div>

        <div class="location-form" style="max-width: 400px;">
          <div class="form-field q-mb-md">
            <label class="text-weight-bold" style="font-size: var(--att-text-sm);">Provincia</label>
            <q-select
              v-model="selectedProvince"
              :options="provinceOptions"
              emit-value
              map-options
              outlined
              dense
              placeholder="Selecciona provincia"
            />
          </div>

          <div class="form-field q-mb-md" v-if="selectedProvince">
            <label class="text-weight-bold" style="font-size: var(--att-text-sm);">Canton</label>
            <q-select
              v-model="selectedCanton"
              :options="cantonOptions"
              emit-value
              map-options
              outlined
              dense
              placeholder="Selecciona canton"
            />
          </div>
        </div>

        <div class="onboarding-actions">
          <q-btn flat color="grey-6" label="Omitir" @click="skipLocation" />
          <q-btn
            color="primary"
            label="Continuar"
            icon-right="arrow_forward"
            :disable="!selectedCanton"
            @click="confirmLocation"
          />
        </div>
      </template>
    </div>
  </q-page>
</template>
