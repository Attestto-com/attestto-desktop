<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { useOid4vp } from '../composables/useOid4vp'
import type { VaultCredential } from '../../shared/vault-api'

const router = useRouter()
const $q = useQuasar()
const { step, error, consent, resultVp, reset, parseRequest, approve } = useOid4vp()

// QR scanner
const videoEl = ref<HTMLVideoElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const scanInterval = ref<ReturnType<typeof setInterval> | null>(null)

// Manual input
const manualUri = ref('')

// Result QR
const resultQrUrl = ref('')

onMounted(() => {
  startScanner()
})

onBeforeUnmount(() => {
  stopScanner()
})

async function startScanner() {
  step.value = 'scanning'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      await videoEl.value.play()
      scanInterval.value = setInterval(scanFrame, 200)
    }
  } catch {
    // Camera not available — show manual input
    step.value = 'idle'
  }
}

function stopScanner() {
  if (scanInterval.value) {
    clearInterval(scanInterval.value)
    scanInterval.value = null
  }
  if (videoEl.value?.srcObject) {
    const tracks = (videoEl.value.srcObject as MediaStream).getTracks()
    tracks.forEach(t => t.stop())
    videoEl.value.srcObject = null
  }
}

function scanFrame() {
  if (!videoEl.value || !canvasEl.value) return
  const video = videoEl.value
  if (video.readyState !== video.HAVE_ENOUGH_DATA) return

  const canvas = canvasEl.value
  const ctx = canvas.getContext('2d')!
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, canvas.width, canvas.height)

  if (code?.data) {
    const data = code.data
    // Check if it looks like an OID4VP request
    if (data.startsWith('openid4vp://') || data.includes('response_type=vp_token') || data.includes('client_id=')) {
      stopScanner()
      handleUri(data)
    }
  }
}

async function handleUri(uri: string) {
  const info = await parseRequest(uri)
  if (!info) return
  // consent screen will be shown via step === 'consent'
}

async function handleManualSubmit() {
  if (!manualUri.value.trim()) return
  stopScanner()
  await handleUri(manualUri.value.trim())
}

function credentialLabel(c: VaultCredential): string {
  const types = Array.isArray(c.type) ? c.type : [c.type]
  const specific = types.find(t => t !== 'VerifiableCredential') || types[0]
  const labels: Record<string, string> = {
    CedulaIdentidadCR: 'Cédula de identidad',
    DrivingLicenseCR: 'Licencia de conducir',
    PassportCR: 'Pasaporte',
    IdentityVC: 'Identidad verificada',
    DocumentSignatureVC: 'Firma de documento',
    DrivingTheoryExamCR: 'Examen teórico',
    DrivingCompetencyCR: 'Competencia de conducción',
  }
  return labels[specific] || specific
}

async function handleApprove() {
  const ok = await approve()
  if (ok && resultVp.value) {
    // Generate QR of the VP for display
    const compact = JSON.stringify(resultVp.value)
    if (compact.length <= 2000) {
      try {
        resultQrUrl.value = await QRCode.toDataURL(compact, { width: 280, margin: 2 })
      } catch { /* too large */ }
    }
  }
}

function handleDeny() {
  reset()
  router.push('/credentials')
}

function goBack() {
  stopScanner()
  reset()
  router.push('/credentials')
}
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <q-btn flat icon="arrow_back" @click="goBack" />
      <div class="text-h5 q-ml-sm">Presentar credencial</div>
    </div>

    <!-- Step: Scanning QR -->
    <div v-if="step === 'scanning' || step === 'idle'" class="column items-center q-gutter-md">
      <p class="text-grey">Escaneá el código QR del verificador, o pegá la URI.</p>

      <!-- Camera viewfinder -->
      <div class="scanner-area" v-show="step === 'scanning'">
        <video ref="videoEl" playsinline muted class="scanner-video" />
        <canvas ref="canvasEl" style="display: none;" />
        <div class="scanner-overlay">
          <div class="scanner-corners" />
        </div>
      </div>

      <!-- Manual input -->
      <div class="row q-gutter-sm" style="width: 100%; max-width: 500px;">
        <q-input
          v-model="manualUri"
          outlined
          dense
          placeholder="openid4vp://..."
          class="col"
          @keydown.enter="handleManualSubmit"
        />
        <q-btn color="primary" label="Enviar" @click="handleManualSubmit" :disable="!manualUri.trim()" />
      </div>
    </div>

    <!-- Step: Parsing -->
    <div v-else-if="step === 'parsing'" class="column items-center q-gutter-md q-pa-xl">
      <q-spinner size="48px" color="primary" />
      <span class="text-grey">Procesando solicitud del verificador...</span>
    </div>

    <!-- Step: Consent -->
    <div v-else-if="step === 'consent' && consent" class="column q-gutter-md" style="max-width: 600px; margin: 0 auto;">
      <q-card>
        <q-card-section>
          <div class="text-h6">Solicitud de verificación</div>
          <p class="text-grey q-mt-sm">
            <strong>{{ consent.clientId }}</strong> solicita las siguientes credenciales:
          </p>
        </q-card-section>

        <!-- Requested types -->
        <q-card-section v-if="consent.requestedTypes.length">
          <p class="text-subtitle2 text-grey">Credenciales solicitadas</p>
          <q-list dense>
            <q-item v-for="req in consent.requestedTypes" :key="req.id">
              <q-item-section avatar>
                <q-icon name="badge" color="primary" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ req.types?.join(', ') || req.id }}</q-item-label>
                <q-item-label caption>{{ req.format }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>

        <!-- Matched credentials -->
        <q-card-section>
          <p class="text-subtitle2" :class="consent.matchResult.satisfied ? 'text-positive' : 'text-negative'">
            <q-icon :name="consent.matchResult.satisfied ? 'check_circle' : 'warning'" class="q-mr-xs" />
            {{ consent.matchResult.satisfied
              ? `${consent.matchedCredentials.length} credencial(es) coinciden`
              : 'No se encontraron credenciales que coincidan' }}
          </p>

          <q-list v-if="consent.matchedCredentials.length" dense separator>
            <q-item v-for="cred in consent.matchedCredentials" :key="cred.id">
              <q-item-section avatar>
                <q-icon name="verified" color="positive" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ credentialLabel(cred) }}</q-item-label>
                <q-item-label caption>{{ cred.issuanceDate }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>

          <!-- Missing -->
          <div v-if="consent.matchResult.missing.length" class="q-mt-sm">
            <p class="text-caption text-negative">Faltan: {{ consent.matchResult.missing.join(', ') }}</p>
          </div>
        </q-card-section>

        <q-separator />

        <q-card-actions align="right">
          <q-btn flat label="Cancelar" color="grey" @click="handleDeny" />
          <q-btn
            unelevated
            label="Aprobar y presentar"
            color="primary"
            :disable="!consent.matchResult.satisfied"
            @click="handleApprove"
          />
        </q-card-actions>
      </q-card>
    </div>

    <!-- Step: Signing / Submitting -->
    <div v-else-if="step === 'signing' || step === 'submitting'" class="column items-center q-gutter-md q-pa-xl">
      <q-spinner size="48px" color="primary" />
      <span class="text-grey">
        {{ step === 'signing' ? 'Firmando presentación...' : 'Enviando al verificador...' }}
      </span>
    </div>

    <!-- Step: Done -->
    <div v-else-if="step === 'done'" class="column items-center q-gutter-md q-pa-xl" style="max-width: 500px; margin: 0 auto;">
      <q-icon name="check_circle" size="64px" color="positive" />
      <div class="text-h6 text-positive">Presentación enviada</div>
      <p class="text-grey text-center">
        Tu presentación verificable fue firmada y enviada al verificador.
      </p>

      <!-- VP QR if available -->
      <img v-if="resultQrUrl" :src="resultQrUrl" alt="VP QR" style="width: 240px; height: 240px; border-radius: 8px;" />

      <q-btn flat label="Volver a credenciales" color="primary" @click="goBack" />
    </div>

    <!-- Step: Error -->
    <div v-else-if="step === 'error'" class="column items-center q-gutter-md q-pa-xl">
      <q-icon name="error" size="48px" color="negative" />
      <div class="text-h6 text-negative">Error</div>
      <p class="text-grey text-center">{{ error }}</p>
      <div class="row q-gutter-sm">
        <q-btn flat label="Reintentar" color="primary" @click="reset(); startScanner()" />
        <q-btn flat label="Volver" @click="goBack" />
      </div>
    </div>
  </q-page>
</template>

<style scoped>
.scanner-area {
  position: relative;
  width: 100%;
  max-width: 400px;
  aspect-ratio: 4/3;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}

.scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scanner-corners {
  width: 200px;
  height: 200px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 16px;
  box-shadow:
    inset 0 0 0 2px transparent,
    -4px -4px 0 -1px var(--q-primary),
    4px -4px 0 -1px var(--q-primary),
    -4px 4px 0 -1px var(--q-primary),
    4px 4px 0 -1px var(--q-primary);
}
</style>
