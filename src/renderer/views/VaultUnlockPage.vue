<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../stores/vault'
import { usePersonaStore } from '../stores/persona'

const router = useRouter()
const vault = useVaultStore()
const persona = usePersonaStore()

const isCreating = ref(false)

onMounted(async () => {
  await vault.refreshStatus()
  isCreating.value = !vault.vaultExists
})

async function createVault() {
  const did = await vault.create('')
  if (did) {
    persona.setPersona('citizen')
    router.replace('/')
  }
}

async function unlockVault() {
  const success = await vault.unlock('')
  if (!success) return
  router.replace('/')
}

function goToRecovery() {
  router.push('/recovery')
}
</script>

<template>
  <q-page class="vault-unlock-page">
    <div class="vault-container">
      <!-- Attestto brand -->
      <div class="vault-brand">
        <span class="vault-brand__text">attestto</span>
        <img src="../../../resources/icon.png" alt="Attestto" class="vault-brand__logo" />
      </div>

      <!-- Create mode — first run -->
      <template v-if="isCreating">
        <h2 class="vault-title att-text-title">Bienvenido</h2>
        <p class="vault-subtitle att-text-body">
          Tu boveda segura almacena tus credenciales verificables y pruebas de identidad.
          Se protege con la seguridad de tu dispositivo. Nada sale de tu computadora.
        </p>

        <q-btn
          color="primary"
          label="Crear boveda segura"
          icon="lock"
          class="full-width q-mb-md"
          size="lg"
          :loading="vault.loading"
          @click="createVault"
        />

        <div v-if="vault.error" class="text-negative text-center q-mb-md">
          {{ vault.error }}
        </div>
      </template>

      <!-- Unlock mode — returning user -->
      <template v-else>
        <h2 class="vault-title att-text-title">Desbloquear</h2>
        <p class="vault-subtitle att-text-body">
          Usa Touch ID o la seguridad de tu dispositivo para acceder a tu boveda.
        </p>

        <div class="vault-cards">
          <!-- Enter Attestto -->
          <button class="vault-card" @click="unlockVault">
            <q-icon name="fingerprint" size="36px" color="primary" />
            <div class="vault-card__title">Entrar a Attestto</div>
            <div class="vault-card__desc">Desbloquea tu boveda con biometrico</div>
            <q-spinner-dots v-if="vault.loading" size="20px" color="primary" class="q-mt-sm" />
          </button>

          <!-- PDF Viewer / Signer — upgrades to signer once identity is verified -->
          <button class="vault-card" @click="router.push('/pdf')">
            <div class="vault-card__icons">
              <q-icon name="picture_as_pdf" size="36px" color="negative" />
              <q-icon
                v-if="vault.identityVerified"
                name="draw"
                size="36px"
                color="positive"
              />
            </div>
            <div class="vault-card__title">
              {{ vault.identityVerified ? 'Visor + Firmador PDF' : 'Visor de PDF' }}
            </div>
            <div class="vault-card__desc">
              {{
                vault.identityVerified
                  ? 'Abrir, verificar, revisar y firmar documentos'
                  : 'Abrir, verificar y revisar documentos'
              }}
            </div>
            <q-badge
              v-if="vault.identityVerified"
              color="positive"
              class="vault-card__badge"
            >
              <q-icon name="verified" size="11px" class="q-mr-xs" />
              Firma habilitada
            </q-badge>
          </button>
        </div>

        <div v-if="vault.error" class="text-negative text-center q-mb-md">
          {{ vault.error }}
        </div>

        <div class="text-center q-mt-md">
          <q-btn
            flat
            color="grey-6"
            label="Recuperar cuenta"
            icon="restore"
            @click="goToRecovery"
          />
        </div>
      </template>

      <!-- Security info -->
      <div class="vault-info q-mt-xl">
        <q-icon name="verified_user" color="positive" size="18px" class="q-mr-xs" />
        <span class="att-text-muted">
          Cifrado xsalsa20-poly1305 · Protegido por tu dispositivo
        </span>
      </div>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.vault-unlock-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 60px);
}

.vault-container {
  max-width: 460px;
  width: 100%;
  padding: 2.5rem 1.5rem;
  text-align: center;
}

.vault-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  margin-bottom: 3rem;
}

.vault-brand__text {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--att-text-title);
  letter-spacing: -0.5px;
}

.vault-brand__logo {
  width: 2rem;
  height: 2rem;
  border-radius: 6px;
}

.vault-title {
  font-size: var(--att-text-2xl);
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.vault-subtitle {
  font-size: var(--att-text-lg);
  opacity: 0.75;
  margin-bottom: 2.25rem;
  line-height: 1.6;
}

.vault-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.vault-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.75rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  color: inherit;

  &:hover {
    border-color: rgba(99, 102, 241, 0.4);
    background: rgba(99, 102, 241, 0.05);
  }
}

.vault-card__title {
  font-size: var(--att-text-base, 0.95rem);
  font-weight: 600;
  color: var(--att-text-title);
}

.vault-card__desc {
  font-size: var(--att-text-sm, 0.8rem);
  color: var(--att-text-muted);
  line-height: 1.4;
}

.vault-card__icons {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.vault-card__badge {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  padding: 0.2rem 0.4rem;
  font-weight: 600;
}

.vault-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  opacity: 0.5;
  font-size: var(--att-text-sm);
}
</style>
