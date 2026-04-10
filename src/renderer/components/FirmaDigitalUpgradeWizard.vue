<script setup lang="ts">
// Firma Digital upgrade — simulated flow. Real PKCS#11: ATT-340.
import { ref, watch } from 'vue'
import { useVaultStore } from '../stores/vault'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const vault = useVaultStore()

type Step = 'insert' | 'pin' | 'progress' | 'success'
const step = ref<Step>('insert')
const pin = ref('')
const progress = ref(0)

function reset(): void {
  step.value = 'insert'
  pin.value = ''
  progress.value = 0
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset()
  },
)

function close(): void {
  emit('update:modelValue', false)
}

function goToPin(): void {
  step.value = 'pin'
}

async function submitPin(): Promise<void> {
  if (pin.value.length < 4) return
  step.value = 'progress'
  progress.value = 0
  // Fake the upgrade in ~2.5s with smooth ticks. No network, no hardware.
  const ticks = 25
  for (let i = 1; i <= ticks; i++) {
    await new Promise((r) => setTimeout(r, 100))
    progress.value = i / ticks
  }
  await vault.upgradeFirmaDigitalMock()
  step.value = 'success'
}
</script>

<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" persistent>
    <q-card class="fd-wizard">
      <div class="fd-wizard__header">
        <q-icon name="badge" size="22px" color="primary" />
        <span class="fd-wizard__title">Firma Digital — Mejora de nivel</span>
        <q-space />
        <q-badge color="orange" class="fd-wizard__demo">DEMO</q-badge>
      </div>

      <!-- Step: insert card -->
      <q-card-section v-if="step === 'insert'" class="fd-wizard__step">
        <q-icon name="credit_card" size="56px" color="primary" />
        <div class="text-h6 q-mt-md">Insertá tu tarjeta Firma Digital</div>
        <div class="text-caption att-text-muted q-mt-sm">
          Conectá el lector de tarjetas y asegurate que el chip esté hacia arriba.
        </div>
        <div class="fd-wizard__demo-note q-mt-md">
          Esta es una simulación para fines de demostración. No se requiere hardware real.
        </div>
        <div class="fd-wizard__actions">
          <q-btn flat label="Cancelar" @click="close" />
          <q-btn unelevated color="blue-6" text-color="white" label="Continuar" @click="goToPin" />
        </div>
      </q-card-section>

      <!-- Step: PIN -->
      <q-card-section v-else-if="step === 'pin'" class="fd-wizard__step">
        <q-icon name="pin" size="56px" color="primary" />
        <div class="text-h6 q-mt-md">Ingresá tu PIN</div>
        <div class="text-caption att-text-muted q-mt-sm">
          PIN de 4 a 8 dígitos de tu tarjeta Firma Digital.
        </div>
        <q-input
          v-model="pin"
          type="password"
          dense
          outlined
          mask="########"
          class="q-mt-md fd-wizard__pin"
          autofocus
        />
        <div class="fd-wizard__actions">
          <q-btn flat label="Atrás" @click="step = 'insert'" />
          <q-btn unelevated color="blue-6" text-color="white" label="Verificar" :disable="pin.length < 4" @click="submitPin" />
        </div>
      </q-card-section>

      <!-- Step: progress -->
      <q-card-section v-else-if="step === 'progress'" class="fd-wizard__step">
        <q-spinner-orbit size="56px" color="primary" />
        <div class="text-h6 q-mt-md">Verificando con la autoridad…</div>
        <q-linear-progress
          :value="progress"
          color="primary"
          class="q-mt-lg fd-wizard__bar"
          rounded
        />
        <div class="text-caption att-text-muted q-mt-sm">
          Cargando certificado de Nivel A+
        </div>
      </q-card-section>

      <!-- Step: success -->
      <q-card-section v-else class="fd-wizard__step">
        <q-icon name="verified" size="64px" color="positive" />
        <div class="text-h5 text-weight-bold q-mt-md">Firma actualizada</div>
        <div class="fd-wizard__level-badge">
          <span>Nivel A+</span>
          <q-badge color="orange" class="q-ml-sm">DEMO</q-badge>
        </div>
        <div class="text-caption att-text-muted q-mt-sm fd-wizard__copy">
          Las firmas que generes a partir de ahora se marcarán como
          <code>firma-digital-mocked</code> con <code>mock: true</code> en su metadata.
          No reemplazan una Firma Digital legal real.
        </div>
        <div class="fd-wizard__actions">
          <q-btn unelevated color="blue-6" text-color="white" label="Listo" @click="close" />
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped lang="scss">
.fd-wizard {
  min-width: 28rem;
  max-width: 32rem;
  background: var(--att-bg-card, #1a1f2e);

  &__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 1.25rem 0.5rem;
  }

  &__title {
    font-weight: 700;
    font-size: 0.95rem;
  }

  &__demo {
    font-size: 0.9rem;
    letter-spacing: 0.05em;
    font-weight: 700;
  }

  &__step {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 1.5rem 2rem 2rem;
  }

  &__demo-note {
    font-size: 0.9rem;
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.08);
    border: 1px dashed rgba(245, 158, 11, 0.4);
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
  }

  &__actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    width: 100%;
    margin-top: 1.5rem;
  }

  &__pin {
    width: 12rem;
  }

  &__bar {
    width: 100%;
  }

  &__level-badge {
    display: flex;
    align-items: center;
    margin-top: 0.5rem;
    font-weight: 700;
    color: var(--q-primary);
  }

  &__copy {
    max-width: 22rem;
    margin-top: 0.75rem;
    code {
      font-family: ui-monospace, monospace;
      background: rgba(255, 255, 255, 0.06);
      padding: 0 0.25rem;
      border-radius: 0.25rem;
    }
  }
}
</style>
