<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../stores/vault'
import { usePersonaStore } from '../stores/persona'
import { usePdfInboxStore } from '../stores/pdfInbox'

const router = useRouter()
const vault = useVaultStore()
const persona = usePersonaStore()
const pdfInbox = usePdfInboxStore()

const isCreating = ref(false)
const isDragging = ref(false)

onMounted(async () => {
  await vault.refreshStatus()
  isCreating.value = !vault.vaultExists
})

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function onPdfDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function onPdfDragLeave() {
  isDragging.value = false
}

async function onPdfDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (!file || !isPdf(file)) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  pdfInbox.setPending(bytes, file.name)
  router.push('/pdf')
}

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
      <!-- Attestto brand lockup -->
      <div class="vault-brand">
        <img src="../../../resources/icon.png" alt="Attestto" class="vault-brand__logo" />
        <span class="vault-brand__text">Attest<span class="vault-brand__accent">to</span></span>
      </div>

      <!-- Create mode — first run -->
      <template v-if="isCreating">
        <h1 class="vault-title">Bienvenido a Attestto</h1>
        <p class="vault-subtitle">
          Tu boveda segura vive en este dispositivo. Nada sale de tu computadora.
        </p>

        <!-- Primary action -->
        <button
          class="vault-action vault-action--primary"
          :disabled="vault.loading"
          data-testid="vault-create-btn"
          @click="createVault"
        >
          <div class="vault-action__icon">
            <q-icon name="lock" size="24px" />
          </div>
          <div class="vault-action__body">
            <div class="vault-action__title">Crear boveda segura</div>
            <div class="vault-action__desc">Se protege con la seguridad de tu dispositivo</div>
          </div>
          <q-spinner-dots v-if="vault.loading" size="22px" class="vault-action__spin" />
          <q-icon v-else name="chevron_right" size="22px" class="vault-action__chevron" />
        </button>

        <div v-if="vault.error" class="vault-error">{{ vault.error }}</div>

        <!-- How it works -->
        <div class="vault-how">
          <div class="vault-how__head">
            <q-icon name="verified_user" size="20px" color="primary" />
            <span>Como funciona</span>
          </div>
          <ol class="vault-how__steps">
            <li><span class="vault-how__n">1.</span> Tu identidad y credenciales se generan en este dispositivo.</li>
            <li><span class="vault-how__n">2.</span> La boveda se cifra y se protege con Touch ID.</li>
            <li><span class="vault-how__n">3.</span> Sin contrasenas, sin servidores, sin cuentas. Ahora ni nunca.</li>
          </ol>
          <p class="vault-how__note">
            Tus llaves nunca salen de tu computadora. Cifrado xsalsa20-poly1305,
            protegido por tu dispositivo.
          </p>
        </div>
      </template>

      <!-- Unlock mode — returning user -->
      <template v-else>
        <h1 class="vault-title">Entrar a Attestto</h1>
        <p class="vault-subtitle">
          Una accion. Sin contrasenas. Tu identidad vive en este dispositivo.
        </p>

        <!-- Primary action — unlock -->
        <button
          class="vault-action vault-action--primary"
          :disabled="vault.loading"
          @click="unlockVault"
        >
          <div class="vault-action__icon">
            <q-icon name="fingerprint" size="24px" />
          </div>
          <div class="vault-action__body">
            <div class="vault-action__title">Desbloquear con Touch ID</div>
            <div class="vault-action__desc">Usa la seguridad de tu dispositivo para abrir tu boveda</div>
          </div>
          <q-spinner-dots v-if="vault.loading" size="22px" class="vault-action__spin" />
          <q-icon v-else name="chevron_right" size="22px" class="vault-action__chevron" />
        </button>

        <!-- Secondary action — PDF viewer / signer, doubles as a drop target -->
        <button
          class="vault-action vault-action--drop"
          :class="{ 'vault-action--dropping': isDragging }"
          @click="router.push('/pdf')"
          @dragover="onPdfDragOver"
          @dragleave="onPdfDragLeave"
          @drop="onPdfDrop"
        >
          <div class="vault-action__icon vault-action__icon--neutral">
            <q-icon :name="isDragging ? 'file_download' : 'picture_as_pdf'" size="24px" color="negative" />
          </div>
          <div class="vault-action__body">
            <div class="vault-action__title">
              {{ isDragging
                ? 'Soltar el PDF aqui'
                : (vault.identityVerified ? 'Visor + Firmador PDF' : 'Visor de PDF') }}
            </div>
            <div class="vault-action__desc">
              {{ isDragging
                ? 'Se abre al instante, sin salir de tu dispositivo'
                : (vault.identityVerified
                    ? 'Arrastra un PDF aqui, o haz clic para verificar y firmar'
                    : 'Arrastra un PDF aqui, o haz clic para abrir y verificar') }}
            </div>
          </div>
          <q-badge
            v-if="vault.identityVerified && !isDragging"
            class="vault-action__badge"
          >
            <q-icon name="verified" size="12px" class="q-mr-xs" />
            Firma habilitada
          </q-badge>
          <q-icon v-else-if="!isDragging" name="chevron_right" size="22px" class="vault-action__chevron" />
        </button>

        <div v-if="vault.error" class="vault-error">{{ vault.error }}</div>

        <div class="vault-recover">
          <button class="vault-recover__link" @click="goToRecovery">
            <q-icon name="restore" size="18px" />
            Recuperar cuenta
          </button>
        </div>

        <!-- What the app does -->
        <div class="vault-how">
          <div class="vault-how__head">
            <q-icon name="shield_moon" size="20px" color="primary" />
            <span>Que es Attestto</span>
          </div>
          <ul class="vault-how__list">
            <li>
              <q-icon name="badge" size="18px" color="primary" />
              <span>Tu identidad y credenciales verificables viven cifradas en este dispositivo.</span>
            </li>
            <li>
              <q-icon name="verified" size="18px" color="primary" />
              <span>Verifica y firma documentos PDF, incluida la Firma Digital de Costa Rica.</span>
            </li>
            <li>
              <q-icon name="cloud_off" size="18px" color="primary" />
              <span>Funciona sin conexion. Nada se sube a ningun servidor, nunca.</span>
            </li>
          </ul>
        </div>
      </template>

      <!-- Security footer -->
      <div class="vault-info">
        <q-icon name="verified_user" color="positive" size="16px" />
        <span>Cifrado xsalsa20-poly1305 · Protegido por tu dispositivo</span>
      </div>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.vault-unlock-page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: calc(100vh - 60px);
  padding: 4rem 1.5rem 2rem;
}

.vault-container {
  max-width: 560px;
  width: 100%;
  text-align: left;
}

// ── Brand lockup ──
.vault-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2.5rem;
}

.vault-brand__logo {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 9px;
}

.vault-brand__text {
  font-size: 1.9rem;
  font-weight: 800;
  color: var(--att-text-title);
  letter-spacing: -0.5px;
}

.vault-brand__accent {
  color: var(--att-primary);
}

// ── Headings ──
.vault-title {
  font-size: 2.4rem;
  font-weight: 800;
  line-height: 1.1;
  color: var(--att-text-title);
  margin: 0 0 0.75rem;
  letter-spacing: -0.5px;
}

.vault-subtitle {
  font-size: var(--att-text-lg);
  color: var(--att-text-muted);
  margin: 0 0 2rem;
  line-height: 1.55;
}

// ── Action cards (primary + secondary) ──
.vault-action {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
  text-align: left;
  padding: 1.1rem 1.25rem;
  margin-bottom: 1rem;
  background: var(--att-bg-surface);
  border: 1px solid var(--att-border);
  border-radius: 0.9rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.05s ease;
  color: inherit;

  &:hover:not(:disabled) {
    border-color: var(--att-primary-border);
    background: var(--att-primary-soft);
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }

  &--primary {
    border-color: var(--att-primary);
    background: var(--att-primary-soft);

    .vault-action__icon {
      background: var(--att-primary);
      color: #fff;
    }

    &:hover:not(:disabled) {
      border-color: var(--att-primary);
      background: rgba(16, 185, 129, 0.14);
    }
  }
}

.vault-action__icon {
  width: 44px;
  height: 44px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--att-bg-elevated);
  color: var(--att-primary);

  &--neutral {
    background: rgba(239, 68, 68, 0.1);
  }
}

.vault-action__body {
  flex: 1;
  min-width: 0;
}

.vault-action__title {
  font-size: var(--att-text-md);
  font-weight: 700;
  color: var(--att-text-title);
}

.vault-action__desc {
  font-size: var(--att-text-sm);
  color: var(--att-text-muted);
  line-height: 1.4;
  margin-top: 2px;
}

.vault-action__chevron {
  color: var(--att-text-disabled);
  flex-shrink: 0;
}

.vault-action__spin {
  color: var(--att-primary);
  flex-shrink: 0;
}

.vault-action__badge {
  flex-shrink: 0;
  background: var(--att-primary);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
}

// Drop target (PDF card) — dashed hint + strong highlight while dragging
.vault-action--drop {
  border-style: dashed;
}

.vault-action--dropping {
  border-style: solid;
  border-color: var(--att-primary);
  background: var(--att-primary-soft);

  .vault-action__icon--neutral {
    background: var(--att-primary);
    color: #fff;
  }
}

// ── How it works panel ──
.vault-how {
  margin-top: 0.5rem;
  padding: 1.25rem 1.5rem;
  background: var(--att-bg-surface);
  border: 1px solid var(--att-border);
  border-radius: 0.9rem;

  &__head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--att-text-md);
    font-weight: 700;
    color: var(--att-text-title);
    margin-bottom: 0.9rem;
  }

  &__steps {
    list-style: none;
    margin: 0 0 0.9rem;
    padding: 0;

    li {
      display: flex;
      gap: 0.5rem;
      font-size: var(--att-text-sm);
      color: var(--att-text-body);
      line-height: 1.5;
      margin-bottom: 0.5rem;
    }
  }

  &__n {
    color: var(--att-primary);
    font-weight: 700;
    flex-shrink: 0;
  }

  &__note {
    margin: 0;
    padding-top: 0.9rem;
    border-top: 1px solid var(--att-border);
    font-size: var(--att-text-sm);
    color: var(--att-text-muted);
    line-height: 1.5;
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;

    li {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      font-size: var(--att-text-sm);
      color: var(--att-text-body);
      line-height: 1.5;
      margin-bottom: 0.7rem;

      &:last-child { margin-bottom: 0; }

      .q-icon { margin-top: 2px; flex-shrink: 0; }
    }
  }
}

// ── Recover link ──
.vault-recover {
  margin: 1.25rem 0 0.5rem;
}

.vault-recover__link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  padding: 0.4rem 0;
  color: var(--att-text-muted);
  font-size: var(--att-text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--att-primary);
  }
}

// ── Error ──
.vault-error {
  color: #fca5a5;
  font-size: var(--att-text-sm);
  margin: 0.25rem 0 1rem;
}

// ── Security footer ──
.vault-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2rem;
  opacity: 0.6;
  font-size: var(--att-text-xs);
  color: var(--att-text-muted);
}
</style>
