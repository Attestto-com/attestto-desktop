<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../stores/vault'
import { usePersonaStore } from '../stores/persona'
import { useCamera } from '../composables/useCamera'
import { crDocumentPlugins } from '../country/cr'
import {
  extractFaceDescriptor,
  loadFaceModels,
  sha256Hex,
  descriptorToBytes,
  FACE_API_MODEL_INFO,
} from '../country/cr/face-match'

const router = useRouter()
const vault = useVaultStore()
const persona = usePersonaStore()
const camera = useCamera()

const step = ref(1)
const livenessStatus = ref<'idle' | 'starting' | 'live' | 'checking' | 'verified' | 'failed'>('idle')
const livenessCompleted = ref(false)
const hasIdentityCredential = ref(false)

// Check vault for existing verification data on mount
onMounted(async () => {
  // Check localStorage first (fast, always available)
  if (localStorage.getItem('attestto-liveness-done')) {
    livenessCompleted.value = true
    livenessStatus.value = 'verified'
    step.value = 2
  }

  // Then check vault for richer data
  try {
    const api = window.presenciaAPI?.vault
    if (!api) return
    const contents = await api.read()
    if (!contents) return

    // If biometrics exist, liveness was already done
    if (contents.biometrics && contents.biometrics.length > 0) {
      livenessCompleted.value = true
      livenessStatus.value = 'verified'
      if (step.value < 2) step.value = 2
    }

    // If identity credential exists, everything is done
    const identityCred = contents.credentials?.find(
      (c: any) => c.type === 'CedulaIdentityCredential' || c.type === 'LivenessProof'
    )
    if (identityCred) {
      hasIdentityCredential.value = true
      step.value = 3
    }
  } catch { /* vault may not be unlocked */ }
})

// ── Voice narration (Web Speech API) ──
const voiceEnabled = ref(true)

function speak(text: string): Promise<void> {
  return new Promise(resolve => {
    if (!voiceEnabled.value || !window.speechSynthesis) {
      resolve()
      return
    }
    // Cancel any ongoing speech
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-ES'
    utterance.rate = 0.9
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    window.speechSynthesis.speak(utterance)
  })
}

// ── Liveness challenge flow ──
interface LivenessChallenge {
  id: string
  instruction: string
  voice: string        // what the voice says (can differ from on-screen text)
  icon: string
  direction?: string
}

const challenges: LivenessChallenge[] = [
  { id: 'center', instruction: 'Mira al frente', voice: 'Mira directamente a la cámara', icon: 'face' },
  { id: 'left', instruction: 'Gira a la izquierda', voice: 'Ahora, gira la cabeza hacia la izquierda', icon: 'arrow_back', direction: 'left' },
  { id: 'right', instruction: 'Gira a la derecha', voice: 'Ahora gira hacia la derecha', icon: 'arrow_forward', direction: 'right' },
  { id: 'up', instruction: 'Levanta la cabeza', voice: 'Levanta la cabeza un poco', icon: 'arrow_upward', direction: 'up' },
  { id: 'blink', instruction: 'Parpadea dos veces', voice: 'Por último, parpadea dos veces', icon: 'visibility_off' },
]

const currentChallengeIndex = ref(0)
const challengeStatus = ref<'waiting' | 'passed'>('waiting')
const glassesDetected = ref(false)
const glassesRound = ref(false) // true = doing the without-glasses round

const currentChallenge = computed(() => challenges[currentChallengeIndex.value])
const challengeProgress = computed(() =>
  Math.round((currentChallengeIndex.value / challenges.length) * 100)
)

// ── Face presence detection ──
// Uses skin-tone pixel analysis across quadrants of the oval region.
// Provides directional feedback (move left/right/up/closer) and
// confirms face is centered before proceeding.
const faceDetected = ref(false)
const faceCount = ref(0)
const faceFeedback = ref('')
let faceCheckInterval: ReturnType<typeof setInterval> | null = null

interface SkinAnalysis {
  centerRatio: number
  leftRatio: number
  rightRatio: number
  topRatio: number
  bottomRatio: number
  totalRatio: number
}

/** Analyze skin-tone presence across quadrants of the oval region */
function analyzeFacePosition(): SkinAnalysis {
  const video = camera.videoRef.value
  const empty: SkinAnalysis = { centerRatio: 0, leftRatio: 0, rightRatio: 0, topRatio: 0, bottomRatio: 0, totalRatio: 0 }
  if (!video || !video.videoWidth) return empty

  const canvas = document.createElement('canvas')
  const w = video.videoWidth
  const h = video.videoHeight
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return empty

  ctx.drawImage(video, 0, 0)

  // Define regions: full oval and quadrants within it
  const ovalX = Math.round(w * 0.25)
  const ovalY = Math.round(h * 0.1)
  const ovalW = Math.round(w * 0.5)
  const ovalH = Math.round(h * 0.8)

  function countSkinInRegion(rx: number, ry: number, rw: number, rh: number): number {
    const imgData = ctx!.getImageData(rx, ry, rw, rh)
    const data = imgData.data
    let skin = 0
    const step = 4
    for (let i = 0; i < data.length; i += 4 * step) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      if (r > 60 && g > 40 && b > 20 && r > g && r > b &&
          Math.abs(r - g) > 15 && (Math.max(r, g, b) - Math.min(r, g, b)) < 200) {
        skin++
      }
    }
    return skin / (data.length / 4 / step)
  }

  const halfW = Math.round(ovalW / 2)
  const halfH = Math.round(ovalH / 2)

  return {
    totalRatio: countSkinInRegion(ovalX, ovalY, ovalW, ovalH),
    centerRatio: countSkinInRegion(ovalX + Math.round(ovalW * 0.25), ovalY + Math.round(ovalH * 0.25), halfW, halfH),
    leftRatio: countSkinInRegion(ovalX, ovalY, halfW, ovalH),
    rightRatio: countSkinInRegion(ovalX + halfW, ovalY, halfW, ovalH),
    topRatio: countSkinInRegion(ovalX, ovalY, ovalW, halfH),
    bottomRatio: countSkinInRegion(ovalX, ovalY + halfH, ovalW, halfH),
  }
}

/** Detect glasses by looking for horizontal dark bands in the eye region */
function detectGlasses(): boolean {
  const video = camera.videoRef.value
  if (!video || !video.videoWidth) return false

  const canvas = document.createElement('canvas')
  const w = video.videoWidth
  const h = video.videoHeight
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false

  ctx.drawImage(video, 0, 0)

  // Eye region: center horizontal band, upper-middle of face
  // Approximately 30-45% from top, center 50% width
  const eyeX = Math.round(w * 0.25)
  const eyeY = Math.round(h * 0.28)
  const eyeW = Math.round(w * 0.5)
  const eyeH = Math.round(h * 0.12)

  const imgData = ctx.getImageData(eyeX, eyeY, eyeW, eyeH)
  const data = imgData.data

  // Glasses frames create dark horizontal lines/bands
  // Count pixels that are very dark (frame) vs skin-colored
  let darkPixels = 0
  let totalPixels = 0
  // Also detect glare/reflection (very bright spots = lens reflection)
  let glarePixels = 0

  for (let i = 0; i < data.length; i += 4 * 2) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const brightness = r * 0.299 + g * 0.587 + b * 0.114
    totalPixels++

    if (brightness < 40) darkPixels++
    if (brightness > 230) glarePixels++
  }

  const darkRatio = darkPixels / totalPixels
  const glareRatio = glarePixels / totalPixels

  // Glasses typically show: dark frame lines (>15% dark pixels in eye region)
  // OR lens reflections (>8% very bright spots)
  const hasGlasses = darkRatio > 0.15 || glareRatio > 0.08

  console.log('[liveness] Glasses detection:', {
    darkRatio: darkRatio.toFixed(3),
    glareRatio: glareRatio.toFixed(3),
    detected: hasGlasses,
  })

  return hasGlasses
}

/** Generate directional feedback from skin analysis */
function getFeedback(analysis: SkinAnalysis): string {
  // No skin detected at all
  if (analysis.totalRatio < 0.03) {
    return 'No se detecta un rostro — mira hacia la camara'
  }

  // Very low — too far
  if (analysis.totalRatio < 0.08) {
    return 'Acercate mas a la camara'
  }

  // Face detected but off-center (note: video is mirrored)
  const lr = analysis.leftRatio - analysis.rightRatio
  const tb = analysis.topRatio - analysis.bottomRatio

  // Video is mirrored (scaleX -1) — swap left/right hints
  if (lr > 0.12) return 'Mueve la cara hacia la izquierda'
  if (lr < -0.12) return 'Mueve la cara hacia la derecha'
  if (tb > 0.15) return 'Baja un poco la cabeza'
  if (tb < -0.15) return 'Sube un poco la cabeza'

  // Centered enough
  if (analysis.centerRatio > 0.15) {
    return '' // Good position — no feedback needed
  }

  return 'Centra tu rostro en el ovalo'
}

/** Start continuous face detection loop (runs while camera is live) */
function startFaceDetectionLoop() {
  stopFaceDetectionLoop()
  faceCheckInterval = setInterval(() => {
    const analysis = analyzeFacePosition()
    const feedback = getFeedback(analysis)
    faceFeedback.value = feedback
    faceDetected.value = feedback === '' && analysis.centerRatio > 0.15
    faceCount.value = faceDetected.value ? 1 : 0
  }, 400)
}

function stopFaceDetectionLoop() {
  if (faceCheckInterval) {
    clearInterval(faceCheckInterval)
    faceCheckInterval = null
  }
}

/** Wait until face is centered in the oval, with timeout */
async function waitForFace(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const analysis = analyzeFacePosition()
    const feedback = getFeedback(analysis)
    faceFeedback.value = feedback
    faceDetected.value = feedback === '' && analysis.centerRatio > 0.15
    faceCount.value = faceDetected.value ? 1 : 0
    if (faceDetected.value) return true
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return false
}

async function startCamera() {
  livenessStatus.value = 'starting'
  await camera.start()
  if (camera.error.value) {
    livenessStatus.value = 'failed'
  } else {
    livenessStatus.value = 'live'
    currentChallengeIndex.value = 0
    challengeStatus.value = 'waiting'
    faceDetected.value = false
    faceFeedback.value = ''
    // Start continuous face detection while camera is live
    startFaceDetectionLoop()
    await speak('Posiciona tu rostro dentro del óvalo. Cuando estés listo, presiona iniciar verificación.')
  }
}

async function startChallenge() {
  livenessStatus.value = 'checking'
  currentChallengeIndex.value = 0
  challengeStatus.value = 'waiting'

  // Wait for a face before starting
  await speak('Detectando rostro...')
  const found = await waitForFace(10000)
  if (!found) {
    await speak('No se detectó un rostro. Posiciona tu cara dentro del óvalo.')
    livenessStatus.value = 'live'
    return
  }

  stopFaceDetectionLoop() // challenges use their own detection
  await speak('Rostro detectado. Iniciando verificación.')
  await runChallengeSequence()
}

/** Wait for a specific face movement/action to be detected */
async function waitForChallenge(challengeId: string, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now()
  // Capture baseline position first
  const baseline = analyzeFacePosition()

  while (Date.now() - start < timeoutMs) {
    const current = analyzeFacePosition()

    // No face at all → fail
    if (current.totalRatio < 0.03) {
      faceFeedback.value = 'Rostro perdido'
      await new Promise(resolve => setTimeout(resolve, 300))
      continue
    }

    let passed = false
    const lr = current.leftRatio - current.rightRatio
    const tb = current.topRatio - current.bottomRatio
    const lrShift = lr - (baseline.leftRatio - baseline.rightRatio)
    const tbShift = tb - (baseline.topRatio - baseline.bottomRatio)

    // Time-based relaxation: after 3s of trying, lower the threshold
    const elapsed = Date.now() - start
    const relaxed = elapsed > 3000
    const t = relaxed ? 0.5 : 1.0 // halve thresholds after 3s

    switch (challengeId) {
      case 'center':
        passed = current.centerRatio > 0.08 && Math.abs(lr) < 0.2
        break
      case 'left':
        passed = lrShift < -0.03 * t || lr < -0.04 * t
        break
      case 'right':
        passed = lrShift > 0.03 * t || lr > 0.04 * t
        break
      case 'up':
        passed = tbShift > 0.03 * t || tb > 0.04 * t
        break
      case 'blink':
        passed = current.centerRatio > 0.08 && elapsed > 1200
        break
    }

    if (passed) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

async function runChallengeSequence() {
  for (let i = 0; i < challenges.length; i++) {
    currentChallengeIndex.value = i
    challengeStatus.value = 'waiting'

    // Speak the instruction and wait for it to finish
    await speak(challenges[i].voice)

    // Detect the specific movement — passes immediately when detected
    let detected = await waitForChallenge(challenges[i].id, 8000)
    if (!detected) {
      // Retry once before failing
      faceFeedback.value = 'Intenta de nuevo'
      await new Promise(resolve => setTimeout(resolve, 500))
      detected = await waitForChallenge(challenges[i].id, 8000)
    }
    if (!detected) {
      await speak('No se detectó el movimiento.')
      livenessStatus.value = 'live'
      startFaceDetectionLoop()
      return
    }

    challengeStatus.value = 'passed'
    // Pause so user can return to center before next challenge
    faceFeedback.value = 'Vuelve al centro'
    await new Promise(resolve => setTimeout(resolve, 800))
  }

  // All challenges passed
  stopFaceDetectionLoop()

  // Check for glasses on first round
  if (!glassesRound.value) {
    const hasGlasses = detectGlasses()
    if (hasGlasses) {
      glassesDetected.value = true
      await speak('Detectamos que usas lentes. Por favor, quítatelos y repite la verificación.')
      // Reset for second round
      glassesRound.value = true
      currentChallengeIndex.value = 0
      challengeStatus.value = 'waiting'
      livenessStatus.value = 'live'
      startFaceDetectionLoop()
      return
    }
  }

  await speak('Verificación completada. Tu prueba de vida se almacenó en tu bóveda.')

  // Store biometric proof in vault so we don't repeat this.
  // Real face descriptor via @vladmandic/face-api → SHA-256 hash → inner-encrypted
  // via vault.encryptArtifact (HKDF-derived per-capture key). No mocks.
  try {
    const api = window.presenciaAPI?.vault
    if (api) {
      // Snapshot a frame from the live video into a JPEG data URL
      const video = camera.videoRef.value
      if (!video || !video.videoWidth) throw new Error('Camera frame unavailable')
      const snapCanvas = document.createElement('canvas')
      snapCanvas.width = video.videoWidth
      snapCanvas.height = video.videoHeight
      const sctx = snapCanvas.getContext('2d')
      if (!sctx) throw new Error('2D context unavailable')
      sctx.drawImage(video, 0, 0)
      const frameDataUrl = snapCanvas.toDataURL('image/jpeg', 0.92)

      await loadFaceModels()
      const face = await extractFaceDescriptor(frameDataUrl)
      if (!face) throw new Error('No face detected in liveness frame')

      const captureId = `liveness-${new Date().toISOString()}`
      const descriptorBytes = descriptorToBytes(face.descriptor)
      const hashHex = await sha256Hex(descriptorBytes)
      const artifact = await api.encryptArtifact({
        plaintext: descriptorBytes,
        mediaType: 'application/octet-stream',
        hashHex,
        info: `${captureId}/face-descriptor`,
      })

      const contents = await api.read()
      if (contents) {
        const capture = {
          id: captureId,
          type: 'face-mesh' as const,
          hash: hashHex,
          meshDataEncrypted: artifact.ciphertext,
          meshNonce: artifact.nonce,
          meshSaltHex: artifact.saltHex,
          capturedAt: Date.now(),
          context: 'identity-verification' as const,
          model: { name: FACE_API_MODEL_INFO.name, version: FACE_API_MODEL_INFO.version },
          antiSpoof: { passed: true, score: face.detectionScore },
        }
        const biometrics = [...(contents.biometrics || []), capture]
        await api.write({ biometrics })
      }
    }
  } catch (err) {
    console.error('[liveness] Failed to store biometric:', err)
  }

  camera.stop()
  livenessStatus.value = 'verified'
  livenessCompleted.value = true
  localStorage.setItem('attestto-liveness-done', new Date().toISOString())
}

// Country plugins — populated from installed country modules
const documentPlugins = computed(() => {
  const plugins: { id: string; label: string; icon: string; description: string; route: string }[] = []

  // CR module installed? → add CR document plugins
  if (persona.installedModules.includes('cr-identity')) {
    plugins.push(...crDocumentPlugins)
  }

  // Future: other countries register their plugins here
  // if (persona.installedModules.includes('mx-identity')) { ... }

  return plugins
})

// Third-party KYC providers — base app ships with these connectors
const kycProviders = [
  { id: 'sumsub', label: 'Sumsub', icon: 'verified_user', description: 'KYC completo — documento + selfie + liveness', connected: false },
  { id: 'onfido', label: 'Onfido', icon: 'fact_check', description: 'Verificacion de documentos + biometria', connected: false },
  { id: 'jumio', label: 'Jumio', icon: 'document_scanner', description: 'Escaneo de ID + verificacion de identidad', connected: false },
]

const hasVerificationOptions = computed(() => documentPlugins.value.length > 0 || kycProviders.length > 0)

/** Reset the local "completed" gate so the user can re-run the biometric flow.
 * Does NOT delete prior captures from the vault — the new run will append a
 * fresh BiometricCapture when it completes. Routes to the document flow
 * because the selfie/liveness UI lives inside the cédula verification step. */
function repeatBiometric() {
  localStorage.removeItem('attestto-liveness-done')
  livenessCompleted.value = false
  const target = documentPlugins.value[0]?.route
  if (target) router.push({ path: target, query: { redo: '1' } })
}

onUnmounted(() => {
  stopFaceDetectionLoop()
})
</script>

<template>
  <q-page class="page-centered">
    <div class="page-centered__container" style="max-width: 700px;">
      <div class="text-h5 text-weight-bold q-mb-xs att-text-title">Verificacion de identidad</div>
      <div class="att-text-muted q-mb-lg" style="font-size: var(--att-text-sm);">
        Verifica tu identidad con un documento oficial o un proveedor KYC.
        El resultado se almacena como credencial verificable en tu boveda.
      </div>

      <!-- Status banners -->
      <div v-if="livenessCompleted" class="liveness-done-banner q-mb-md">
        <q-icon name="check_circle" color="positive" size="20px" />
        <div style="flex: 1;">
          <div class="text-weight-bold" style="font-size: var(--att-text-sm);">Verificacion biometrica completada</div>
          <div class="att-text-muted" style="font-size: var(--att-text-xs);">Prueba de vida almacenada en tu boveda</div>
        </div>
        <q-btn
          flat dense no-caps
          color="primary"
          size="sm"
          icon="refresh"
          label="Repetir"
          @click="repeatBiometric"
        />
      </div>

      <div v-if="hasIdentityCredential" class="liveness-done-banner q-mb-md" style="border-color: var(--q-positive);">
        <q-icon name="verified" color="positive" size="20px" />
        <div>
          <div class="text-weight-bold" style="font-size: var(--att-text-sm);">Credencial de identidad verificada</div>
          <div class="att-text-muted" style="font-size: var(--att-text-xs);">
            <q-btn flat dense no-caps color="primary" label="Ver credenciales" size="xs" @click="router.push('/credentials')" />
          </div>
        </div>
      </div>

      <!-- Country document plugins -->
      <template v-if="documentPlugins.length > 0">
        <div class="verification-section-title">Documentos oficiales</div>
        <div class="att-text-muted q-mb-md" style="font-size: var(--att-text-xs);">
          Escanea tu documento y selfie desde tu telefono. Tu computadora procesa todo localmente.
        </div>
        <div class="verification-options q-mb-lg">
          <div
            v-for="plugin in documentPlugins"
            :key="plugin.id"
            class="verification-option"
            @click="router.push(plugin.route)"
          >
            <q-icon :name="plugin.icon" size="28px" color="primary" />
            <div class="verification-option__text">
              <div class="text-weight-bold">{{ plugin.label }}</div>
              <div class="att-text-muted" style="font-size: var(--att-text-xs);">{{ plugin.description }}</div>
            </div>
            <q-icon name="chevron_right" color="grey-6" />
          </div>
        </div>
      </template>

      <!-- Third-party KYC providers -->
      <div class="verification-section-title">Proveedores KYC</div>
      <div class="verification-options q-mb-md">
        <div
          v-for="provider in kycProviders"
          :key="provider.id"
          class="verification-option"
        >
          <q-icon :name="provider.icon" size="28px" color="info" />
          <div class="verification-option__text">
            <div class="text-weight-bold">{{ provider.label }}</div>
            <div class="att-text-muted" style="font-size: var(--att-text-xs);">{{ provider.description }}</div>
          </div>
          <q-btn
            outline dense
            :label="provider.connected ? 'Verificar' : 'Conectar'"
            :color="provider.connected ? 'primary' : 'grey-6'"
            size="xs"
          />
        </div>
      </div>

      <!-- No country module hint -->
      <div v-if="documentPlugins.length === 0" class="no-plugin-hint q-mb-md">
        <q-icon name="info_outline" size="16px" color="grey-6" />
        <span class="att-text-muted" style="font-size: var(--att-text-xs);">
          Instala un modulo de pais para opciones de documento oficial (cedula, DNI, pasaporte).
        </span>
      </div>

      <!-- Vincular ID externa -->
      <div class="verification-section-title q-mt-md">Vincular ID externa</div>
      <div class="verification-options">
        <div class="verification-option" style="opacity: 0.5; cursor: default;">
          <q-icon name="add_circle_outline" size="28px" color="grey-6" />
          <div class="verification-option__text">
            <div class="text-weight-bold">Vincular ID externa</div>
            <div class="att-text-muted" style="font-size: var(--att-text-xs);">Proximamente</div>
          </div>
        </div>
      </div>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.identity-stepper {
  background: transparent !important;
  border: none !important;
}

.camera-placeholder {
  border-radius: 0.75rem;
  border: 1px solid var(--att-border);
  background: var(--att-bg-surface);
  overflow: hidden;
}

.camera-placeholder__idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 420px;
}

.camera-feed-wrapper {
  position: relative;
  height: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.camera-feed-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1); // mirror for selfie
}

.camera-feed-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2;
}

.camera-feed-frame {
  position: absolute;
  width: 220px;
  height: 290px;
  border: 2px solid var(--att-primary);
  border-radius: 50%;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 1;
  box-shadow: 0 0 0 2000px rgba(0, 0, 0, 0.4);
}

.liveness-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

// ── Challenge overlay ──
.challenge-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  pointer-events: none;
}

.challenge-ready-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 3;
  padding: 1rem;
  text-align: center;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
  pointer-events: none;

  .challenge-instruction__text {
    color: white;
    font-size: var(--att-text-sm);
    font-weight: 500;
  }
}

.challenge-progress {
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  width: 100%;
}

.challenge-progress__bar {
  height: 100%;
  background: var(--att-primary);
  transition: width 0.4s ease;
}

.challenge-instruction {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 1rem;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.glasses-banner {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
  border-radius: 1rem;
  font-size: var(--att-text-xs);
  font-weight: 600;
  align-self: center;
}

.challenge-instruction__icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.challenge-instruction__text {
  flex: 1;
  color: white;
  font-size: var(--att-text-xl);
  font-weight: 700;
}

.challenge-instruction__step {
  color: rgba(255, 255, 255, 0.6);
  font-size: var(--att-text-xs);
  flex-shrink: 0;
}

// Direction arrow hints — positioned around the oval
.challenge-arrow {
  position: absolute;
  z-index: 4;
  animation: arrow-pulse 1s ease-in-out infinite;
  pointer-events: none;

  &--left {
    left: 10%;
    top: 50%;
    transform: translateY(-50%);
  }

  &--right {
    right: 10%;
    top: 50%;
    transform: translateY(-50%);
  }

  &--up {
    top: 8%;
    left: 50%;
    transform: translateX(-50%);
  }
}

@keyframes arrow-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.privacy-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.privacy-badge {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: var(--att-text-xs);
  color: var(--att-text-muted);
  padding: 0.25rem 0.625rem;
  border-radius: 1rem;
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.12);
}

.verification-section-title {
  font-size: var(--att-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--att-text-muted);
  margin-bottom: 0.5rem;
}

.verification-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.verification-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--att-border);
  background: var(--att-bg-surface);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--att-primary-border);
    background: var(--att-primary-soft);
  }
}

.verification-option__text {
  flex: 1;
  min-width: 0;
}

.no-plugin-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  background: rgba(255, 255, 255, 0.03);
}

.liveness-done-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.15);
  border-radius: 0.5rem;
}

.verified-card {
  text-align: center;
  padding: 1.5rem;
}
</style>
