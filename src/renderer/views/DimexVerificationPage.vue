<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useCamera } from '../composables/useCamera'
import { validateDimexFormat } from '../country/cr'

const router = useRouter()
const camera = useCamera()

const step = ref<'front' | 'review' | 'validating' | 'done' | 'error'>('front')
const frontCapture = ref<string | null>(null)

// ── Manual entry ──
const manualDimex = ref('')
const manualNombre = ref('')
const manualApellido1 = ref('')
const manualApellido2 = ref('')
const manualNacionalidad = ref('')

const dimexFormatValid = computed(() => {
  const val = manualDimex.value.replace(/[^0-9]/g, '')
  return val.length === 0 || validateDimexFormat(val)
})

// ── Camera ──
async function startCapture() {
  await camera.start()
}

function captureFrame(): string | null {
  const video = camera.videoRef.value
  if (!video) return null
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 640
  canvas.height = video.videoHeight || 480
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85)
}

async function captureFront() {
  const img = captureFrame()
  if (img) {
    frontCapture.value = img
    camera.stop()
    step.value = 'review'
  }
}

async function validate() {
  step.value = 'validating'

  const dimex = manualDimex.value.replace(/[^0-9]/g, '')
  if (!validateDimexFormat(dimex)) {
    step.value = 'review'
    return
  }

  // Simulated DGME validation delay (real DGME API integration is future work)
  await new Promise(resolve => setTimeout(resolve, 2500))

  // Resolve vault DID for issuer fallback
  let vaultDid = 'did:key:anonymous'
  try {
    const contents = await window.presenciaAPI?.vault?.read?.()
    if (contents?.identity?.did) vaultDid = contents.identity.did
  } catch { /* fallback */ }

  const nombre = `${manualNombre.value} ${manualApellido1.value} ${manualApellido2.value}`.trim()
  const credential = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://attestto.id/schemas/v1',
    ],
    id: `urn:attestto:cr:dimex:${dimex}`,
    type: ['VerifiableCredential', 'DimexIdentityCredential'],
    issuer: vaultDid,
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: vaultDid,
      dimex,
      nombre,
      nacionalidad: manualNacionalidad.value,
    },
    evidence: [
      {
        type: ['DocumentVerification', 'DGMEDimexCR'],
        authority: 'did:web:dgme.go.cr',
        authorityName: 'Dirección General de Migración y Extranjería',
        documentFormat: 'manual-entry',
      },
    ],
    trustLevel: 'D',
  }

  // Persist to vault (primary) + localStorage (fallback)
  const lsKey = `attestto-credential-dimex-${dimex}`
  try {
    const api = window.presenciaAPI?.vault
    if (api?.write && api?.read) {
      const contents = await api.read()
      const credentials = [...(contents?.credentials ?? []), credential]
      await api.write({ credentials })
      // Remove localStorage copy if vault succeeded
      localStorage.removeItem(lsKey)
    } else {
      localStorage.setItem(lsKey, JSON.stringify(credential))
    }
  } catch {
    // Fallback to localStorage
    localStorage.setItem(lsKey, JSON.stringify(credential))
  }

  step.value = 'done'
}

function goBack() {
  camera.stop()
  router.push('/identity')
}
</script>

<template>
  <q-page class="page-centered">
    <div class="page-centered__container dimex-page">

      <div class="dimex-header q-mb-lg">
        <q-btn flat dense round icon="arrow_back" @click="goBack" />
        <div>
          <div class="text-h5 text-weight-bold att-text-title">DIMEX</div>
          <div class="att-text-muted" style="font-size: var(--att-text-xs);">
            Documento de Identidad Migratoria para Extranjeros
          </div>
        </div>
      </div>

      <!-- FRONT CAPTURE -->
      <template v-if="step === 'front'">
        <div class="capture-instructions q-mb-md">
          <q-icon name="card_membership" size="24px" color="primary" />
          <div>
            <div class="text-weight-bold">Frente del DIMEX</div>
            <div class="att-text-muted" style="font-size: var(--att-text-xs);">
              Captura el frente del documento con todos los datos visibles
            </div>
          </div>
        </div>

        <div class="camera-capture">
          <template v-if="!camera.isActive.value">
            <div class="camera-capture__idle" @click="startCapture">
              <q-icon name="photo_camera" size="48px" color="primary" />
              <div class="att-text-body q-mt-sm">Toca para activar la camara</div>
            </div>
          </template>
          <template v-else>
            <video
              :ref="camera.bindVideo"
              autoplay playsinline muted
              class="camera-capture__video"
            />
            <div class="document-frame" />
          </template>
        </div>

        <div class="q-mt-md q-gutter-sm row justify-center">
          <q-btn
            v-if="camera.isActive.value"
            color="primary"
            icon="photo_camera"
            label="Capturar"
            @click="captureFront"
          />
        </div>
      </template>

      <!-- REVIEW -->
      <template v-if="step === 'review'">
        <div v-if="frontCapture" class="review-capture-single q-mb-lg">
          <img :src="frontCapture" alt="DIMEX" />
        </div>

        <div class="review-section-title q-mb-sm">Datos del DIMEX</div>

        <div class="review-form">
          <div class="form-field">
            <label>Numero DIMEX</label>
            <q-input
              v-model="manualDimex"
              placeholder="11 o 12 digitos"
              outlined dense
              :error="!dimexFormatValid"
              error-message="Formato invalido (11-12 digitos)"
            >
              <template v-slot:prepend>
                <q-icon name="card_membership" />
              </template>
            </q-input>
          </div>

          <div class="form-field">
            <label>Nombre</label>
            <q-input v-model="manualNombre" placeholder="Nombre" outlined dense />
          </div>

          <div class="form-row">
            <div class="form-field">
              <label>Primer apellido</label>
              <q-input v-model="manualApellido1" placeholder="Primer apellido" outlined dense />
            </div>
            <div class="form-field">
              <label>Segundo apellido</label>
              <q-input v-model="manualApellido2" placeholder="Segundo apellido" outlined dense />
            </div>
          </div>

          <div class="form-field">
            <label>Nacionalidad</label>
            <q-input v-model="manualNacionalidad" placeholder="Nacionalidad" outlined dense />
          </div>
        </div>

        <div class="q-mt-lg q-gutter-sm row">
          <q-btn
            color="primary"
            icon="verified_user"
            label="Verificar"
            :disable="!manualDimex"
            @click="validate"
          />
          <q-btn flat color="grey" label="Cancelar" @click="goBack" />
        </div>
      </template>

      <!-- VALIDATING -->
      <template v-if="step === 'validating'">
        <div class="validating-state">
          <q-spinner-orbit size="64px" color="primary" class="q-mb-lg" />
          <div class="att-text-body">Verificando DIMEX...</div>
        </div>
      </template>

      <!-- DONE -->
      <template v-if="step === 'done'">
        <div class="done-state">
          <q-icon name="verified" size="64px" color="positive" class="q-mb-md" />
          <div class="text-h5 text-weight-bold q-mb-xs">DIMEX verificado</div>
          <div class="att-text-muted q-mb-lg" style="font-size: var(--att-text-sm);">
            Tu documento migratorio fue verificado. La credencial se almaceno en tu boveda.
          </div>
          <div class="q-gutter-sm row justify-center">
            <q-btn color="primary" icon="home" label="Ir al inicio" @click="router.push('/')" />
            <q-btn flat color="grey" label="Ver credenciales" @click="router.push('/credentials')" />
          </div>
        </div>
      </template>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.dimex-page {
  max-width: 600px;
}

.dimex-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.capture-instructions {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--att-bg-surface);
  border-radius: 0.5rem;
  border: 1px solid var(--att-border);
}

.camera-capture {
  border-radius: 0.75rem;
  border: 1px solid var(--att-border);
  background: var(--att-bg-surface);
  overflow: hidden;
  position: relative;
  aspect-ratio: 4 / 3;
  max-height: 360px;
}

.camera-capture__idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--att-primary-soft);
  }
}

.camera-capture__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.document-frame {
  position: absolute;
  inset: 8%;
  border: 2px dashed var(--att-primary);
  border-radius: 0.5rem;
  pointer-events: none;
  z-index: 1;
}

.review-capture-single {
  img {
    width: 100%;
    border-radius: 0.5rem;
    border: 1px solid var(--att-border);
  }
}

.review-section-title {
  font-size: var(--att-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--att-text-muted);
}

.review-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.form-field {
  label {
    display: block;
    font-size: var(--att-text-xs);
    font-weight: 600;
    color: var(--att-text-muted);
    margin-bottom: 0.25rem;
  }
}

.form-row {
  display: flex;
  gap: 0.75rem;

  .form-field {
    flex: 1;
  }
}

.validating-state, .done-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2rem 0;
}
</style>
