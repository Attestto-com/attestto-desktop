<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../stores/vault'
import SigningOrderBuilder from '@/components/signing/SigningOrderBuilder.vue'
import type { Signer } from '@/components/signing/SigningOrderBuilder.vue'

const router = useRouter()
const vault = useVaultStore()
// Signing requires a verified identity. The cédula KYC flow flips
// vault.identityVerified, which is the legal-capacity gate for issuing any
// signature from this app. Without it, we show a locked state instead of
// the signing wizard.
const canSign = computed(() => vault.identityVerified)

type Step = 'document' | 'signers' | 'review' | 'signing' | 'complete'

const currentStep = ref<Step>('document')
const signers = ref<Signer[]>([])
const deadline = ref('')
const documentName = ref('')
const documentHash = ref('')
const documentPages = ref(0)

// Demo: simulate file selection
const selectedFile = ref(false)

function selectDocument() {
  // In real app: electron dialog.showOpenDialog({ filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  // Then compute SHA-256 locally
  selectedFile.value = true
  documentName.value = 'Contrato de Hipoteca — Lote 45, Escazu'
  documentHash.value = 'sha256:7f3a9c2b...e4b2d1f8'
  documentPages.value = 15
}

const canProceedToSigners = computed(() => selectedFile.value)
const canProceedToReview = computed(() => signers.value.length >= 1)

function startSigning() {
  currentStep.value = 'signing'
  // In real app: for each signer in order, send DIDComm SigningRequest
  // For demo: simulate completion after 3 seconds
  setTimeout(() => {
    signers.value = signers.value.map(s => ({ ...s, status: 'signed' as const }))
    currentStep.value = 'complete'
  }, 3000)
}

const signingRequestPreview = computed(() => ({
  type: 'AttesttoSigningRequest',
  issuer: 'did:sns:demo',
  document: {
    hash: documentHash.value,
    name: documentName.value,
    pages: documentPages.value,
  },
  signers: signers.value.map(s => ({
    position: s.position,
    did: s.did,
    role: s.role,
    mode: s.mode,
    methods: s.methods,
  })),
  deadline: deadline.value || null,
}))

const steps = [
  { name: 'document', label: 'Documento', icon: 'description' },
  { name: 'signers', label: 'Firmantes', icon: 'group' },
  { name: 'review', label: 'Revisar', icon: 'preview' },
  { name: 'signing', label: 'Firmando', icon: 'draw' },
  { name: 'complete', label: 'Completo', icon: 'check_circle' },
]

const stepIndex = computed(() => steps.findIndex(s => s.name === currentStep.value))
</script>

<template>
  <q-page class="signing-page">
    <div v-if="!canSign" class="signing-page__container">
      <div class="signing-locked">
        <q-icon name="lock" size="64px" color="warning" />
        <div class="text-h5 text-weight-bold att-text-title q-mt-md">
          Verificá tu identidad para firmar
        </div>
        <div class="text-body2 att-text-muted q-mt-sm signing-locked__copy">
          La capacidad de firmar documentos en Attestto se desbloquea cuando verificás
          tu cédula. Una sola vez, después firmás cuando quieras.
        </div>
        <q-btn
          color="blue-6"
          text-color="white"
          icon="badge"
          label="Verificar identidad"
          unelevated
          class="q-mt-lg"
          @click="router.push('/cedula')"
        />
      </div>
    </div>

    <div v-else class="signing-page__container">
      <!-- Stepper header -->
      <div class="signing-stepper">
        <div
          v-for="(step, i) in steps"
          :key="step.name"
          class="signing-step"
          :class="{
            'signing-step--active': step.name === currentStep,
            'signing-step--done': i < stepIndex,
          }"
        >
          <div class="signing-step__dot">
            <q-icon v-if="i < stepIndex" name="check" size="14px" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          <span class="signing-step__label">{{ step.label }}</span>
          <div v-if="i < steps.length - 1" class="signing-step__line" />
        </div>
      </div>

      <!-- Step 1: Document -->
      <div v-if="currentStep === 'document'" class="signing-content">
        <div class="text-h5 text-weight-bold att-text-title q-mb-xs">Seleccionar documento</div>
        <div class="text-caption att-text-muted q-mb-lg">
          El documento permanece en tu dispositivo. Solo el hash viaja por la red.
        </div>

        <div v-if="!selectedFile" class="document-dropzone" @click="selectDocument">
          <q-icon name="upload_file" size="56px" color="grey-6" />
          <div class="text-body1 att-text-body q-mt-md">Seleccionar PDF</div>
          <div class="text-caption att-text-disabled">
            Haz clic o arrastra un archivo aqui
          </div>
        </div>

        <div v-else class="document-selected">
          <div class="document-selected__icon">
            <q-icon name="picture_as_pdf" size="40px" color="negative" />
          </div>
          <div class="document-selected__info">
            <div class="text-body1 text-weight-bold att-text-title">{{ documentName }}</div>
            <div class="text-caption att-text-body">{{ documentPages }} paginas</div>
            <div class="text-caption att-text-disabled att-text-mono">
              {{ documentHash }}
            </div>
          </div>
          <q-btn flat dense icon="close" color="grey-6" @click="selectedFile = false" />
        </div>

        <div class="q-mt-md">
          <q-input
            v-model="deadline"
            label="Fecha limite (opcional)"
            dark
            outlined
            dense
            type="date"
            class="q-mb-md"
          />
        </div>

        <div class="signing-actions">
          <q-space />
          <q-btn
            unelevated
            color="blue-6"
            text-color="white"
            label="Siguiente"
            icon-right="arrow_forward"
            :disable="!canProceedToSigners"
            @click="currentStep = 'signers'"
          />
        </div>
      </div>

      <!-- Step 2: Signers -->
      <div v-if="currentStep === 'signers'" class="signing-content">
        <div class="text-h5 text-weight-bold att-text-title q-mb-xs">Definir firmantes</div>
        <div class="text-caption att-text-muted q-mb-lg">
          Cada firmante recibe una solicitud via DIDComm. Firman con su llave local.
        </div>

        <SigningOrderBuilder v-model="signers" />

        <div class="signing-actions q-mt-lg">
          <q-btn
            flat
            label="Atras"
            icon="arrow_back"
            @click="currentStep = 'document'"
          />
          <q-space />
          <q-btn
            unelevated
            color="blue-6"
            text-color="white"
            label="Revisar"
            icon-right="arrow_forward"
            :disable="!canProceedToReview"
            @click="currentStep = 'review'"
          />
        </div>
      </div>

      <!-- Step 3: Review -->
      <div v-if="currentStep === 'review'" class="signing-content">
        <div class="text-h5 text-weight-bold att-text-title q-mb-xs">Revisar solicitud</div>
        <div class="text-caption att-text-muted q-mb-lg">
          Esta solicitud se enviara como Verifiable Credential via DIDComm.
        </div>

        <!-- Document summary -->
        <div class="review-card q-mb-md">
          <div class="review-card__label">Documento</div>
          <div class="text-body2 att-text-title">{{ documentName }}</div>
          <div class="text-caption att-text-muted att-text-mono">{{ documentHash }}</div>
        </div>

        <!-- Signers summary -->
        <div class="review-card q-mb-md">
          <div class="review-card__label">Firmantes ({{ signers.length }})</div>
          <div v-for="s in signers" :key="s.id" class="review-signer">
            <span class="review-signer__pos">{{ s.position }}</span>
            <span class="att-text-subtitle">{{ s.name }}</span>
            <span class="att-text-muted">— {{ s.role }}</span>
            <q-badge
              :color="s.mode === 'parallel' ? 'accent' : 'grey-7'"
              :label="s.mode === 'parallel' ? 'Paralelo' : 'Secuencial'"
              size="xs"
            />
          </div>
        </div>

        <!-- VC preview -->
        <div class="review-card q-mb-md">
          <div class="review-card__label">Solicitud (VC preview)</div>
          <pre class="review-json">{{ JSON.stringify(signingRequestPreview, null, 2) }}</pre>
        </div>

        <div class="signing-actions">
          <q-btn flat label="Atras" icon="arrow_back" @click="currentStep = 'signers'" />
          <q-space />
          <q-btn
            unelevated
            color="blue-6"
            text-color="white"
            label="Enviar solicitudes"
            icon="send"
            @click="startSigning"
          />
        </div>
      </div>

      <!-- Step 4: Signing in progress -->
      <div v-if="currentStep === 'signing'" class="signing-content signing-content--center">
        <q-spinner-orbit size="64px" color="primary" />
        <div class="text-h6 att-text-subtitle q-mt-lg">Enviando solicitudes via DIDComm...</div>
        <div class="text-caption att-text-muted q-mt-sm">
          Cada firmante recibira la solicitud en su app Attestto.
          Las firmas se recolectan automaticamente.
        </div>

        <div class="signing-progress q-mt-xl">
          <div v-for="s in signers" :key="s.id" class="signing-progress__item">
            <q-icon
              :name="s.status === 'signed' ? 'check_circle' : 'hourglass_top'"
              :color="s.status === 'signed' ? 'positive' : 'warning'"
              size="20px"
            />
            <span class="att-text-body">{{ s.name }}</span>
            <span class="text-caption" :class="s.status === 'signed' ? 'text-positive' : 'text-warning'">
              {{ s.status === 'signed' ? 'Firmado' : 'Pendiente' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Step 5: Complete -->
      <div v-if="currentStep === 'complete'" class="signing-content signing-content--center">
        <q-icon name="check_circle" size="80px" color="positive" />
        <div class="text-h5 text-weight-bold att-text-title q-mt-md">Documento firmado</div>
        <div class="text-caption att-text-body q-mt-sm q-mb-xl">
          Todas las firmas recolectadas. PAdES embebido. Hash anclado en Solana.
        </div>

        <div class="review-card q-mb-md" style="text-align: left;">
          <q-list dense>
            <q-item>
              <q-item-section avatar><q-icon name="description" color="primary" size="sm" /></q-item-section>
              <q-item-section>
                <q-item-label caption>Documento</q-item-label>
                <q-item-label>{{ documentName }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-item>
              <q-item-section avatar><q-icon name="tag" color="primary" size="sm" /></q-item-section>
              <q-item-section>
                <q-item-label caption>Hash final</q-item-label>
                <q-item-label class="att-text-mono">{{ documentHash }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-item>
              <q-item-section avatar><q-icon name="link" color="secondary" size="sm" /></q-item-section>
              <q-item-section>
                <q-item-label caption>Ancla Solana</q-item-label>
                <q-item-label class="att-text-mono">tx:4k8f2a...c7e1b3</q-item-label>
              </q-item-section>
            </q-item>
            <q-item>
              <q-item-section avatar><q-icon name="group" color="positive" size="sm" /></q-item-section>
              <q-item-section>
                <q-item-label caption>Firmantes</q-item-label>
                <q-item-label>{{ signers.length }} firmas PAdES embebidas</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>

        <div class="row q-gutter-sm">
          <q-btn unelevated color="blue-6" text-color="white" label="Ver en vault" icon="lock" @click="$router.push('/credentials')" />
          <q-btn flat color="grey-5" label="Nueva firma" icon="add" @click="currentStep = 'document'; selectedFile = false; signers = []" />
        </div>
      </div>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.signing-locked {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 4rem 1.5rem;

  &__copy {
    max-width: 28rem;
  }
}
</style>
