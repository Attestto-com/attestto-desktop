<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePersonaStore } from '../stores/persona'

const router = useRouter()
const persona = usePersonaStore()

// Core modules are always-on (Identidad, Credenciales, Auditoria) — hide from explorer
const optionalAvailable = computed(() =>
  persona.availableModules.filter(m => m.sector !== 'core'),
)
const optionalInstalled = computed(() =>
  persona.activeModules.filter(m => m.sector !== 'core'),
)

function install(id: string) {
  persona.installModule(id)
}

function open(route: string) {
  router.push(route)
}
</script>

<template>
  <q-page class="explore-page">
    <div class="explore-page__container">
      <div class="explore-header">
        <q-icon name="extension" size="22px" color="primary" />
        <h2 class="explore-header__title">Explorar modulos</h2>
      </div>
      <p class="explore-sub">
        Cada modulo hereda identidad, proctoring y auditoria del shell. Los modulos core
        (Identidad, Credenciales, Auditoria) ya estan activos.
      </p>

      <!-- Instalados (no-core) — TOP -->
      <div v-if="optionalInstalled.length > 0" class="explore-section">
        <div class="explore-section__header">Instalados</div>
        <div class="explore-grid">
          <div
            v-for="mod in optionalInstalled"
            :key="mod.id"
            class="explore-card explore-card--installed"
          >
            <div class="explore-card__head">
              <q-icon :name="mod.icon" size="20px" color="info" />
              <q-chip dense color="info" text-color="white" label="Instalado" class="explore-card__chip" />
            </div>
            <div class="explore-card__title">{{ mod.name }}</div>
            <div class="explore-card__desc">{{ mod.description }}</div>
            <div class="explore-card__actions">
              <q-btn
                unelevated
                color="primary"
                label="Abrir"
                icon-right="arrow_forward"
                size="xs"
                no-caps
                @click="open(mod.route)"
              />
              <q-btn
                flat
                color="grey-5"
                label="Quitar"
                size="xs"
                no-caps
                @click="persona.uninstallModule(mod.id)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Disponibles -->
      <div v-if="optionalAvailable.length > 0" class="explore-section">
        <div class="explore-section__header">Disponibles</div>
        <div class="explore-grid">
          <div
            v-for="mod in optionalAvailable"
            :key="mod.id"
            class="explore-card"
          >
            <div class="explore-card__head">
              <q-icon :name="mod.icon" size="20px" color="primary" />
              <q-chip dense outline color="grey-6" text-color="grey-4" :label="mod.sector" class="explore-card__chip" />
            </div>
            <div class="explore-card__title">{{ mod.name }}</div>
            <div class="explore-card__desc">{{ mod.description }}</div>
            <div class="explore-card__actions">
              <q-btn
                unelevated
                color="primary"
                label="Instalar"
                icon="add"
                size="xs"
                no-caps
                @click="install(mod.id)"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-if="optionalAvailable.length === 0" class="explore-empty">
        <p class="att-text-muted">Tenes todos los modulos disponibles instalados.</p>
      </div>
    </div>
  </q-page>
</template>

<style scoped>
.explore-page__container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 24px 16px;
}

.explore-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.explore-header__title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  line-height: 1.2;
}
.explore-sub {
  font-size: 0.75rem;
  opacity: 0.6;
  margin: 0 0 14px;
  line-height: 1.35;
}

.explore-section {
  margin-bottom: 16px;
}
.explore-section__header {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.55;
  margin-bottom: 8px;
}

.explore-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.explore-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
}
.explore-card--installed {
  border-color: rgba(96,165,250,0.4);
  background: rgba(59,130,246,0.06);
}
.explore-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.explore-card__chip {
  font-size: 0.65rem;
  height: 18px;
}
.explore-card__title {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.2;
}
.explore-card__desc {
  font-size: 0.72rem;
  opacity: 0.65;
  line-height: 1.3;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.explore-card__actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 4px;
}

.explore-empty {
  text-align: center;
  padding: 24px;
}
</style>
