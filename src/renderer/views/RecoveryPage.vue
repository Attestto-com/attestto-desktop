<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../stores/vault'

const router = useRouter()
const vault = useVaultStore()

const passphrase = ref('')
const userDid = ref('')
const guardianDids = ref(['', ''])
const showPassphrase = ref(false)

const canSubmit = computed(() =>
  passphrase.value.length >= 6 &&
  userDid.value.trim().length > 10 &&
  guardianDids.value.every((d) => d.trim().length > 10) &&
  !vault.loading,
)

async function submit() {
  if (!canSubmit.value) return

  const success = await vault.recover(
    passphrase.value,
    userDid.value.trim(),
    guardianDids.value.map((d) => d.trim()),
  )

  if (success) {
    router.replace('/')
  }
}

function goBack() {
  router.replace('/unlock')
}
</script>

<template>
  <q-page class="recovery-page">
    <div class="recovery-container">
      <q-icon name="restore" size="48px" color="warning" class="q-mb-md" />
      <h2 class="recovery-title att-text-title">Recuperar cuenta</h2>
      <p class="recovery-subtitle att-text-body">
        Necesitas tu contrasena, tu DID, y al menos 2 de tus 3 guardianes
        para reconstruir tu boveda en este dispositivo.
      </p>

      <div class="recovery-form">
        <q-input
          v-model="passphrase"
          :type="showPassphrase ? 'text' : 'password'"
          label="Tu contrasena"
          outlined
          dark
          class="q-mb-md"
        >
          <template #append>
            <q-icon
              :name="showPassphrase ? 'visibility_off' : 'visibility'"
              class="cursor-pointer"
              @click="showPassphrase = !showPassphrase"
            />
          </template>
        </q-input>

        <q-input
          v-model="userDid"
          label="Tu DID"
          hint="ej. did:key:z6Mk..."
          outlined
          dark
          class="q-mb-md"
        >
          <template #prepend>
            <q-icon name="fingerprint" />
          </template>
        </q-input>

        <div class="text-subtitle2 text-weight-bold q-mb-sm att-text-title">
          Guardianes (minimo 2)
        </div>

        <q-input
          v-for="(_, i) in guardianDids"
          :key="i"
          v-model="guardianDids[i]"
          :label="`Guardian ${i + 1}`"
          outlined
          dark
          class="q-mb-md"
        >
          <template #prepend>
            <q-icon name="person" />
          </template>
        </q-input>

        <div v-if="vault.error" class="text-negative text-center q-mb-md text-caption">
          {{ vault.error }}
        </div>

        <q-btn
          color="warning"
          text-color="dark"
          label="Recuperar boveda"
          icon="restore"
          class="full-width q-mb-md"
          :loading="vault.loading"
          :disable="!canSubmit"
          @click="submit"
        />

        <div class="text-center">
          <q-btn flat color="grey-6" label="Volver" icon="arrow_back" size="sm" @click="goBack" />
        </div>
      </div>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.recovery-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.recovery-container {
  max-width: 460px;
  width: 100%;
  padding: 40px 24px;
  text-align: center;
}

.recovery-brand {
  margin-bottom: 24px;
  opacity: 0.9;
}

.recovery-title {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 8px;
}

.recovery-subtitle {
  font-size: 14px;
  opacity: 0.7;
  margin-bottom: 32px;
  line-height: 1.5;
}

.recovery-form {
  text-align: left;
}
</style>
