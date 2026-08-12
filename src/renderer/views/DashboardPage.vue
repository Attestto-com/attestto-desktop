<script setup lang="ts">
// Inicio — the home dashboard. Shows an identity summary + an onboarding /
// pending-tasks checklist driven by real vault state (like CORTEX's dashboard),
// instead of redirecting to settings.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../stores/vault'

const router = useRouter()
const vault = useVaultStore()

const credentialCount = ref(0)

async function loadCredentials() {
  try {
    const api = (window as unknown as { presenciaAPI?: any }).presenciaAPI
    const contents = await api?.vault?.read()
    credentialCount.value = (contents?.credentials ?? []).length
  } catch { /* leave 0 */ }
}

onMounted(loadCredentials)

interface Task {
  key: string
  label: string
  desc: string
  icon: string
  done: boolean
  cta: string
  route: string
}

const tasks = computed<Task[]>(() => [
  {
    key: 'vault',
    label: 'Creá tu bóveda segura',
    desc: 'Protegida por tu dispositivo (biométrico).',
    icon: 'lock',
    done: vault.vaultExists,
    cta: 'Crear', route: '/unlock',
  },
  {
    key: 'identity',
    label: 'Verificá tu identidad',
    desc: 'Cédula + Padrón Electoral + reconocimiento facial.',
    icon: 'badge',
    done: vault.identityVerified,
    cta: 'Verificar', route: '/verify/cr/cedula',
  },
  {
    key: 'credentials',
    label: 'Agregá una credencial',
    desc: 'Guardá pruebas verificables en tu bóveda.',
    icon: 'verified',
    done: credentialCount.value > 0,
    cta: 'Agregar', route: '/credentials',
  },
  {
    key: 'recovery',
    label: 'Configurá la recuperación',
    desc: 'Guardianes 2-de-3 para recuperar tu cuenta.',
    icon: 'restore',
    done: vault.guardiansConfigured,
    cta: 'Configurar', route: '/recovery',
  },
])

const doneCount = computed(() => tasks.value.filter((t) => t.done).length)
const progressPct = computed(() => Math.round((doneCount.value / tasks.value.length) * 100))
const allDone = computed(() => doneCount.value === tasks.value.length)
</script>

<template>
  <q-page padding>
    <!-- Header -->
    <div class="dash-header">
      <div>
        <div class="text-h4 text-weight-bold">Inicio</div>
        <div class="att-text-muted">Aquí está el resumen de tu identidad y tareas pendientes.</div>
      </div>
    </div>

    <div class="dash-grid">
      <!-- Identity summary card -->
      <div class="dash-card dash-card--identity">
        <div class="dash-card__head">
          <q-icon name="fingerprint" size="22px" color="primary" />
          <span>Tu identidad Attestto</span>
        </div>
        <div class="dash-identity">
          <div class="dash-identity__avatar"><span>tt</span></div>
          <div>
            <div class="dash-identity__status">
              <q-icon :name="vault.identityVerified ? 'verified' : 'schedule'" size="16px" :color="vault.identityVerified ? 'positive' : 'warning'" />
              {{ vault.identityVerified ? 'Identidad verificada' : 'Identidad sin verificar' }}
            </div>
            <div class="att-text-muted" style="font-size: var(--att-text-xs);">
              {{ credentialCount }} credencial(es) en tu bóveda
            </div>
          </div>
        </div>
        <q-btn unelevated color="primary" class="full-width" label="Abrir billetera de identidad" @click="router.push('/identity')" />
      </div>

      <!-- Onboarding / pending tasks -->
      <div class="dash-card dash-card--tasks">
        <div class="dash-card__head">
          <span>Comenzá</span>
          <span class="dash-progress-label">{{ doneCount }} / {{ tasks.length }}</span>
        </div>
        <div class="dash-progress"><div class="dash-progress__fill" :style="{ width: progressPct + '%' }" /></div>

        <div v-if="allDone" class="dash-alldone">
          <q-icon name="check_circle" size="28px" color="positive" />
          <span>¡Todo listo! Tu identidad está configurada.</span>
        </div>

        <div v-for="t in tasks" :key="t.key" class="dash-task" :class="{ 'dash-task--done': t.done }">
          <div class="dash-task__icon">
            <q-icon :name="t.done ? 'check' : t.icon" size="18px" />
          </div>
          <div class="dash-task__body">
            <div class="dash-task__label">{{ t.label }}</div>
            <div class="dash-task__desc">{{ t.desc }}</div>
          </div>
          <div class="dash-task__action">
            <span v-if="t.done" class="dash-badge dash-badge--done">Listo</span>
            <q-btn v-else flat dense no-caps color="primary" :label="t.cta" @click="router.push(t.route)" />
          </div>
        </div>
      </div>
    </div>

    <!-- Documents -->
    <div class="dash-card dash-card--docs">
      <div class="dash-card__head">
        <q-icon name="picture_as_pdf" size="20px" color="primary" />
        <span>Mis documentos</span>
      </div>
      <div class="row items-center justify-between">
        <span class="att-text-muted">Visualizá y firmá documentos PDF con tu identidad.</span>
        <q-btn flat no-caps color="primary" label="Abrir visor" @click="router.push('/pdf')" />
      </div>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.dash-header { margin-bottom: 24px; }

.dash-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(360px, 1.4fr);
  gap: 20px;
  margin-bottom: 20px;

  @media (max-width: 900px) { grid-template-columns: 1fr; }
}

.dash-card {
  background: var(--att-bg-surface);
  border: 1px solid var(--att-border);
  border-radius: 16px;
  padding: 20px;
}

.dash-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 700;
  font-size: var(--att-text-md);
  color: var(--att-text-title);
  margin-bottom: 16px;

  span:first-child { display: inline-flex; align-items: center; gap: 8px; }
}

.dash-identity {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;

  .dash-identity__avatar {
    width: 48px; height: 48px; border-radius: 50%;
    background: linear-gradient(135deg, var(--att-primary), var(--att-primary-dark));
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700;
  }
  .dash-identity__status {
    display: flex; align-items: center; gap: 6px;
    font-weight: 600; color: var(--att-text-body);
  }
}

.dash-progress-label { font-size: var(--att-text-xs); color: var(--att-text-muted); font-weight: 600; }
.dash-progress {
  height: 6px; border-radius: 3px; background: var(--att-bg-elevated);
  overflow: hidden; margin-bottom: 16px;
  .dash-progress__fill { height: 100%; background: var(--att-primary); transition: width 0.4s ease; }
}

.dash-alldone {
  display: flex; align-items: center; gap: 10px;
  padding: 12px; margin-bottom: 12px;
  background: rgba(34, 197, 94, 0.1); border-radius: 10px;
  color: var(--att-text-body);
}

.dash-task {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--att-border);

  .dash-task__icon {
    width: 34px; height: 34px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--att-primary-soft); color: var(--att-primary);
    flex-shrink: 0;
  }
  .dash-task__body { flex: 1; }
  .dash-task__label { font-weight: 600; color: var(--att-text-body); }
  .dash-task__desc { font-size: var(--att-text-xs); color: var(--att-text-muted); }
}
.dash-task--done .dash-task__icon { background: rgba(34, 197, 94, 0.15); color: #22c55e; }

.dash-badge--done {
  padding: 3px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
  background: rgba(34, 197, 94, 0.15); color: #22c55e;
}
</style>
