<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

interface SectorInfo {
  title: string
  icon: string
  description: string
  modules: string[]
}

const sectorMap: Record<string, SectorInfo> = {
  salud: {
    title: 'Salud',
    icon: 'local_hospital',
    description: 'Citas medicas verificadas, recetas digitales, historial clinico portable.',
    modules: ['CCSS — Citas verificadas', 'Recetas digitales (VC)', 'Historial clinico portable', 'Telemedicina con presencia'],
  },
  educacion: {
    title: 'Educacion',
    icon: 'school',
    description: 'Examenes de admision, titulos verificables, acreditacion academica.',
    modules: ['Examenes proctoreados', 'Titulos como VC', 'Acreditacion institucional', 'Transferencia de creditos'],
  },
  legal: {
    title: 'Legal',
    icon: 'gavel',
    description: 'Audiencias remotas, actos notariales digitales, firma de documentos.',
    modules: ['Poder Judicial — Audiencias', 'Actos notariales digitales', 'Firma Digital integrada', 'Expediente electronico'],
  },
  finanzas: {
    title: 'Finanzas',
    icon: 'account_balance_wallet',
    description: 'KYC verificado, transacciones USDC/CRCD, treasury institucional.',
    modules: ['KYC/KYB onboarding', 'USDC en Solana', 'SINPE / CRCD bridge', 'Treasury multisig'],
  },
  buzon: {
    title: 'Buzon Nacional',
    icon: 'mail_outline',
    description: 'Notificaciones oficiales via DIDComm. Acuse de recibo con validez legal.',
    modules: ['Notificaciones de Hacienda', 'CCSS avisos', 'Municipalidades', 'Acuse de recibo legal'],
  },
}

const sector = computed(() => {
  const key = route.path.replace('/', '')
  return sectorMap[key] || { title: 'Sector', icon: 'apps', description: '', modules: [] }
})
</script>

<template>
  <q-page class="sector-page">
    <div class="sector-page__container">
      <!-- Hero -->
      <div class="sector-hero">
        <div class="sector-hero__icon-ring">
          <q-icon :name="sector.icon" size="56px" color="primary" />
        </div>
        <h2 class="sector-hero__title">{{ sector.title }}</h2>
        <p class="sector-hero__description">{{ sector.description }}</p>
        <q-chip outline color="grey-6" text-color="grey-4" icon="schedule" label="En desarrollo" />
      </div>

      <!-- Planned modules -->
      <div class="sector-modules">
        <div class="sector-modules__header">Modulos planificados</div>
        <div class="sector-modules__grid">
          <div
            v-for="(mod, i) in sector.modules"
            :key="i"
            class="sector-module-card"
          >
            <q-icon name="extension" size="24px" color="grey-6" />
            <span>{{ mod }}</span>
          </div>
        </div>
      </div>

      <!-- CTA -->
      <div class="sector-cta">
        <p class="att-text-muted">
          Los modulos se instalan desde el Marketplace.
          Cada modulo hereda identidad, proctoring y auditoria del shell.
        </p>
      </div>
    </div>
  </q-page>
</template>
