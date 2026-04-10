<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../../stores/vault'

const router = useRouter()
const vault = useVaultStore()

interface JourneyStep {
  id: string
  title: string
  description: string
  whyItMatters: string
  icon: string
  route: string
  done: boolean
}

// Two-step path. Biometric goes first because the cédula verification reuses
// the live face for the document/face match — registering biometrics first
// makes the order obvious to the user. Guardians are NOT in the path (they're
// surfaced as a persistent warning in Mi cuenta → Seguridad instead).
const steps = computed<JourneyStep[]>(() => [
  {
    id: 'biometrics',
    title: 'Registro biometrico',
    description: 'Tu rostro sirve como llave personal. Cada vez que hagas algo importante, confirmamos que sos vos.',
    whyItMatters: 'La biometria nunca sale de tu dispositivo. No se comparte, no se sube a ningun servidor.',
    icon: 'face',
    route: '/identity',
    done: vault.identityVerified,
  },
  {
    id: 'identity',
    title: 'Verifica tu identidad',
    description: 'Confirma quien sos con tu documento oficial. Solo vos podes hacer esto.',
    whyItMatters: 'Tu identidad queda guardada solo en tu dispositivo. Nadie mas tiene acceso — ni siquiera nosotros.',
    icon: 'badge',
    route: '/identity',
    done: vault.identityVerified,
  },
])

const currentStepIndex = computed(() => {
  const idx = steps.value.findIndex(s => !s.done)
  return idx === -1 ? steps.value.length : idx
})

const allDone = computed(() => steps.value.every(s => s.done))

function goToStep(step: JourneyStep, index: number) {
  // Only allow clicking current or completed steps
  if (index <= currentStepIndex.value) {
    router.push(step.route)
  }
}
</script>

<template>
  <!-- Journey in progress (component renders nothing once everything is done) -->
  <div v-if="!allDone" class="journey-steps">
    <div class="journey-steps__header">
      <div class="home-section-title">Tu recorrido</div>
      <div class="att-text-disabled" style="font-size: var(--att-text-xs);">
        Paso {{ currentStepIndex + 1 }} de {{ steps.length }}
      </div>
    </div>

    <div class="journey-steps__list">
      <div
        v-for="(step, i) in steps"
        :key="step.id"
        class="journey-step"
        :class="{
          'journey-step--done': step.done,
          'journey-step--active': i === currentStepIndex,
          'journey-step--locked': i > currentStepIndex,
        }"
        @click="goToStep(step, i)"
      >
        <!-- Step number / check -->
        <div class="journey-step__indicator">
          <q-icon v-if="step.done" name="check_circle" size="28px" color="positive" />
          <div v-else-if="i === currentStepIndex" class="journey-step__number journey-step__number--active">
            {{ i + 1 }}
          </div>
          <div v-else class="journey-step__number">
            {{ i + 1 }}
          </div>
          <!-- Connector line -->
          <div v-if="i < steps.length - 1" class="journey-step__line" :class="{ 'journey-step__line--done': step.done }" />
        </div>

        <!-- Content -->
        <div class="journey-step__content">
          <div class="journey-step__header">
            <q-icon :name="step.icon" size="20px" :color="step.done ? 'positive' : i === currentStepIndex ? 'primary' : 'grey-7'" />
            <span class="journey-step__title">{{ step.title }}</span>
            <q-icon v-if="i > currentStepIndex" name="lock" size="14px" color="grey-8" />
          </div>
          <div class="journey-step__description">{{ step.description }}</div>

          <!-- Privacy note — shown for active step -->
          <div v-if="i === currentStepIndex" class="journey-step__privacy">
            <q-icon name="lock" size="14px" color="positive" />
            <span>{{ step.whyItMatters }}</span>
          </div>

          <!-- CTA for active step -->
          <q-btn
            v-if="i === currentStepIndex"
            color="primary"
            :label="step.title"
            icon-right="arrow_forward"
            size="sm"
            class="q-mt-sm"
            @click.stop="router.push(step.route)"
          />
        </div>
      </div>
    </div>
  </div>

  <!-- Educational footer — only visible while journey is in progress (i.e. the
       user still needs to learn what we do with their data). Once they've
       completed onboarding the boxes go away to reduce noise. -->
  <div v-if="!allDone" class="journey-education">
    <div class="journey-education__card">
      <q-icon name="smartphone" size="20px" color="primary" />
      <div>
        <div class="journey-education__title">Todo vive en tu dispositivo</div>
        <div class="journey-education__text">
          Tu identidad, documentos y datos personales se guardan unicamente en esta computadora, cifrados con llaves que solo vos controlas.
        </div>
      </div>
    </div>
    <div class="journey-education__card">
      <q-icon name="visibility_off" size="20px" color="primary" />
      <div>
        <div class="journey-education__title">Nosotros no vemos nada</div>
        <div class="journey-education__text">
          Attestto no tiene servidores con tu informacion. No podemos ver tus datos, ni compartirlos, ni venderlos. Punto.
        </div>
      </div>
    </div>
    <div class="journey-education__card">
      <q-icon name="key" size="20px" color="primary" />
      <div>
        <div class="journey-education__title">Vos decidis que compartir</div>
        <div class="journey-education__text">
          Cuando alguien necesita verificar algo tuyo, vos elegis exactamente que mostrar — nada mas, nada menos.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.journey-complete {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: 12px;
  margin-bottom: 24px;

  &__icon {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: rgba(16, 185, 129, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
}

.journey-steps {
  margin-bottom: 24px;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  &__list {
    display: flex;
    flex-direction: column;
  }
}

.journey-step {
  display: flex;
  gap: 14px;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &--locked {
    opacity: 0.45;
    cursor: default;
  }

  &__indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    width: 28px;
  }

  &__number {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--att-bg-elevated);
    border: 2px solid var(--att-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: var(--att-text-muted);
    flex-shrink: 0;

    &--active {
      background: var(--att-primary);
      border-color: var(--att-primary);
      color: white;
    }
  }

  &__line {
    width: 2px;
    flex: 1;
    min-height: 16px;
    background: var(--att-border);
    margin: 4px 0;

    &--done {
      background: rgba(16, 185, 129, 0.4);
    }
  }

  &__content {
    flex: 1;
    padding-bottom: 20px;
  }

  &__header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  &__title {
    font-size: var(--att-text-base);
    font-weight: 700;
    color: var(--att-text-title);
  }

  &--locked &__title {
    color: var(--att-text-muted);
  }

  &__description {
    font-size: var(--att-text-sm);
    color: var(--att-text-body);
    line-height: 1.5;
    margin-bottom: 4px;
  }

  &__privacy {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--att-text-xs);
    color: rgba(16, 185, 129, 0.85);
    padding: 8px 10px;
    background: rgba(16, 185, 129, 0.06);
    border-radius: 8px;
    line-height: 1.4;
  }
}

.journey-education {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;

  &__card {
    display: flex;
    gap: 10px;
    padding: 14px;
    background: var(--att-bg-surface);
    border: 1px solid var(--att-border);
    border-radius: 10px;
  }

  &__title {
    font-size: var(--att-text-sm);
    font-weight: 700;
    color: var(--att-text-title);
    margin-bottom: 4px;
  }

  &__text {
    font-size: var(--att-text-xs);
    color: var(--att-text-muted);
    line-height: 1.5;
  }
}
</style>
