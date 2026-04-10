<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../stores/vault'

const router = useRouter()
const vault = useVaultStore()

const step = ref(1)
const guardianDids = ref(['', '', ''])
const loading = ref(false)

const allFilled = computed(() =>
  guardianDids.value.every((d) => d.trim().length > 10),
)

async function activate() {
  if (!allFilled.value) return
  loading.value = true
  try {
    await vault.setupGuardians(
      guardianDids.value.map((d) => d.trim()) as [string, string, string],
    )
    await vault.backup()
    router.replace('/')
  } catch {
    // Error shown via vault.error
  } finally {
    loading.value = false
  }
}

function skipForNow() {
  router.replace('/')
}
</script>

<template>
  <q-page class="guardian-page">
    <div class="guardian-container">
      <!-- Step 1: Explanation -->
      <template v-if="step === 1">
        <div class="text-center q-mb-xl">
          <q-icon name="group" size="64px" color="primary" class="q-mb-md" />
          <h2 class="guardian-title att-text-title">Protege tu cuenta</h2>
          <p class="guardian-subtitle att-text-body">
            Si pierdes tu dispositivo, tus guardianes pueden ayudarte a recuperar tu cuenta.
            Necesitas 3 personas de confianza — con 2 de ellas puedes recuperar todo.
          </p>
        </div>

        <div class="guardian-features q-mb-xl">
          <div class="guardian-feature">
            <q-icon name="shield" color="positive" size="20px" />
            <span>Tus guardianes no pueden ver tus datos — solo almacenan un fragmento cifrado</span>
          </div>
          <div class="guardian-feature">
            <q-icon name="lock" color="warning" size="20px" />
            <span>Necesitas tu contrasena + 2 guardianes para recuperar. Nadie puede hacerlo solo.</span>
          </div>
          <div class="guardian-feature">
            <q-icon name="public" color="info" size="20px" />
            <span>Funciona sin internet — los fragmentos viajan por el mesh P2P</span>
          </div>
        </div>

        <div class="guardian-actions">
          <q-btn flat color="grey-6" label="Configurar despues" @click="skipForNow" />
          <q-btn
            color="primary"
            label="Elegir guardianes"
            icon-right="arrow_forward"
            @click="step = 2"
          />
        </div>
      </template>

      <!-- Step 2: Enter guardian DIDs -->
      <template v-else-if="step === 2">
        <h2 class="guardian-title att-text-title">Agrega tus guardianes</h2>
        <p class="guardian-subtitle att-text-body">
          Ingresa el DID de 3 personas o instituciones de confianza.
          Pueden ser amigos, familiares, o un banco/notario.
        </p>

        <div class="guardian-inputs q-mb-xl">
          <q-input
            v-for="(_, i) in guardianDids"
            :key="i"
            v-model="guardianDids[i]"
            :label="`Guardian ${i + 1}${i === 2 ? ' (institucional recomendado)' : ''}`"
            :hint="i === 0 ? 'ej. did:key:z6Mk...' : undefined"
            outlined
            dark
            class="q-mb-md"
          >
            <template #prepend>
              <q-icon :name="i === 2 ? 'account_balance' : 'person'" />
            </template>
          </q-input>
        </div>

        <div class="guardian-actions">
          <q-btn flat color="grey-6" label="Atras" icon="arrow_back" @click="step = 1" />
          <q-btn
            color="primary"
            label="Confirmar"
            icon-right="arrow_forward"
            :disable="!allFilled"
            @click="step = 3"
          />
        </div>
      </template>

      <!-- Step 3: Confirm -->
      <template v-else>
        <h2 class="guardian-title att-text-title">Confirmar guardianes</h2>
        <p class="guardian-subtitle att-text-body">
          Estos 3 guardianes almacenaran un fragmento cifrado de tu boveda.
          Con 2 de ellos y tu contrasena, puedes recuperar tu cuenta en cualquier dispositivo.
        </p>

        <q-list bordered separator class="rounded-borders bg-dark q-mb-xl">
          <q-item v-for="(did, i) in guardianDids" :key="i">
            <q-item-section avatar>
              <q-icon :name="i === 2 ? 'account_balance' : 'person'" color="primary" />
            </q-item-section>
            <q-item-section>
              <q-item-label>Guardian {{ i + 1 }}</q-item-label>
              <q-item-label caption class="text-mono" style="word-break: break-all; font-size: 11px;">
                {{ did }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-icon name="check_circle" color="positive" />
            </q-item-section>
          </q-item>
        </q-list>

        <div v-if="vault.error" class="text-negative text-center q-mb-md">
          {{ vault.error }}
        </div>

        <div class="guardian-actions">
          <q-btn flat color="grey-6" label="Atras" icon="arrow_back" @click="step = 2" />
          <q-btn
            color="primary"
            label="Activar proteccion"
            icon="shield"
            :loading="loading"
            @click="activate"
          />
        </div>
      </template>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.guardian-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.guardian-container {
  max-width: 520px;
  width: 100%;
  padding: 40px 24px;
}

.guardian-brand {
  text-align: center;
  margin-bottom: 32px;
  opacity: 0.9;
}

.guardian-title {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 12px;
  text-align: center;
}

.guardian-subtitle {
  font-size: 16px;
  opacity: 0.75;
  margin-bottom: 24px;
  line-height: 1.6;
  text-align: center;
}

.guardian-features {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.guardian-feature {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  font-size: 15px;
  opacity: 0.8;
  line-height: 1.5;
}

.guardian-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.text-mono {
  font-family: monospace;
}
</style>
