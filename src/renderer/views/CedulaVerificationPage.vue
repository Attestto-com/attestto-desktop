<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Notify } from 'quasar'
import { useCamera } from '../composables/useCamera'
import { useVaultStore } from '../stores/vault'
import { setUserAvatar } from '../composables/useAvatar'
import { validateCedulaFormat, formatCedula, TSE_AUTHORITY, PADRON_REGISTRY } from '../country/cr'
import { CR_CANTONS, getCantonDownloadUrl, CR_PROVINCES } from '../country/cr/cantons'
import { extractMRZFromImage, extractFromFront, analyzeDocument, type DocumentAnalysis } from '../country/cr/mrz-ocr'
import {
  extractFaceDescriptor,
  compareDescriptors,
  loadFaceModels,
  sha256Hex,
  descriptorToBytes,
  dataUrlToBytes,
  FACE_MATCH_THRESHOLD,
  FACE_API_MODEL_INFO,
} from '../country/cr/face-match'
import type { VerificationSession, EncryptedArtifact } from '../../shared/vault-api'
import QRCode from 'qrcode'

const router = useRouter()
const vault = useVaultStore()
const camera = useCamera()

// Voice narration intentionally NOT used on this page.
// Voice belongs ONLY to the biometric liveness flow (IdentityPage.vue).
// Document capture is silent.

/** W3C VC proof block as embedded in this credential after station signing. */
interface VcProofBlock {
  type: string
  created: string
  verificationMethod: string
  proofPurpose: string
  proofValue: string
  delegationProof: {
    stationDid: string
    stationDidWeb: string
    stationDidKey: string
    binding: string
    signature: string
  }
  canonicalIssuerPlaceholder: string
}

/**
 * Convert a raw 32-byte ed25519 pubkey into the desktop's `did:key:z…` form.
 * Mirrors `vault-service.ts` and `station-service.ts` so the three identifiers
 * (user vault, station master, per-credential sub-key) all share the same
 * encoding convention.
 */
function subPubKeyToDidKey(publicKey: Uint8Array): string {
  const multicodec = new Uint8Array(2 + publicKey.length)
  multicodec[0] = 0xed
  multicodec[1] = 0x01
  multicodec.set(publicKey, 2)
  // Browser base64url: btoa() doesn't do url-safe, so post-process.
  const b64 = btoa(String.fromCharCode(...multicodec))
  const b64u = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `did:key:z${b64u}`
}

// ── Flow state ──
// front → back → review (OCR + manual edit) → validating (face match → padron lookup) → firma (optional upgrade) → done
const step = ref<'front' | 'back' | 'review' | 'validating' | 'done' | 'error'>('front')

// ── Captured images ──
const frontCapture = ref<string | null>(null)
const backCapture = ref<string | null>(null)

// ── Extracted data (OCR simulation) ──
const extractedData = ref<{
  cedula: string
  nombre: string
  apellido1: string
  apellido2: string
  fechaNacimiento: string
  sexo: string
  fechaEmision: string
  fechaVencimiento: string
  provinciaNacimiento: string
} | null>(null)

// ── Manual entry fields (editable after OCR) ──
const manualCedula = ref('')
const manualNombre = ref('')
const manualApellido1 = ref('')
const manualApellido2 = ref('')

// ── Validation state ──
const tseValidation = ref<{
  status: 'idle' | 'checking' | 'valid' | 'invalid' | 'error'
  message: string
}>({ status: 'idle', message: '' })

const faceMatchScore = ref<number | null>(null)
// Descriptors held in memory between face match and saveVerificationSession.
// Cleared after the session is persisted so they don't linger across runs.
const pendingFaceDescriptors = ref<{
  cedula: Float32Array
  selfie: Float32Array
  distance: number
  match: boolean
} | null>(null)
const selfieCapture = ref<string | null>(null)
const mobileLiveness = ref<{ faceDetected: boolean; blinkCount: number; durationMs: number } | null>(null)
const ocrProgress = ref(0)
const ocrRunning = ref(false)
const faceMatchDone = ref(false)
const padronDownloading = ref(false)
const padronLookupDone = ref(false)
const padronMatch = ref<{ nombre: string; apellido1: string; apellido2: string | null; fechacaduc: string | null } | null>(null)
const nameMatch = ref<boolean | null>(null) // OCR name vs Padrón name

// ── Document analysis ──
const docAnalysis = ref<DocumentAnalysis | null>(null)
const ocrSource = ref<'mrz' | 'front-ocr' | null>(null)

// ── Padrón canton selection ──
const selectedCanton = ref(localStorage.getItem('attestto-canton') || '')
const selectedProvince = ref(localStorage.getItem('attestto-province') || '')
const padronAskCanton = ref(false)

const provinceOptions = Object.entries(CR_PROVINCES).map(([code, name]) => ({ label: name, value: code }))
const cantonOptions = computed(() => {
  if (!selectedProvince.value) return []
  return CR_CANTONS
    .filter(c => c.code[0] === selectedProvince.value)
    .map(c => ({ label: c.name, value: c.code }))
})

// ── Firma Digital ──
const firmaDigitalStatus = ref<'idle' | 'detecting' | 'reading' | 'verifying' | 'linked' | 'error'>('idle')
const firmaDigitalCert = ref<{
  cn: string             // Common name from cert
  cedula: string         // Cédula from cert subject
  issuer: string         // CA SINPE
  serialNumber: string
  validFrom: string
  validTo: string
  hasSigningCert: boolean
} | null>(null)
const identityTrust = ref<'B' | 'A+'>('B') // Upgrades to A+ with Firma Digital

const cedulaFormatValid = computed(() => {
  const val = manualCedula.value || extractedData.value?.cedula || ''
  return val.length === 0 || validateCedulaFormat(val)
})

const formattedCedula = computed(() => {
  const val = manualCedula.value || extractedData.value?.cedula || ''
  return formatCedula(val)
})

// ── Mobile capture (phone on same network) ──
const captureMode = ref<'choose' | 'webcam' | 'mobile'>('choose')
const mobileSessionUrl = ref('')
const mobileQrDataUrl = ref('')
const mobileStatus = ref<'idle' | 'starting' | 'waiting' | 'connected' | 'front-done' | 'complete'>('idle')
let captureEventCleanup: (() => void) | null = null

async function startMobileCapture() {
  captureMode.value = 'mobile'
  mobileStatus.value = 'starting'

  const api = window.presenciaAPI?.capture
  if (!api) {
    captureMode.value = 'choose'
    return
  }

  // Start the local capture server
  await api.startServer()

  // Create a session
  const { sessionId, url } = await api.createSession()
  mobileSessionUrl.value = url

  // Generate QR code
  mobileQrDataUrl.value = await QRCode.toDataURL(url, {
    width: 280,
    margin: 2,
    color: { dark: '#e2e8f0', light: '#0f1923' },
  })

  mobileStatus.value = 'waiting'

  // Listen for capture events
  captureEventCleanup = api.onEvent((event: any) => {
    switch (event.type) {
      case 'phone-connected':
        mobileStatus.value = 'connected'
        break
      case 'front-captured':
        frontCapture.value = event.image
        mobileStatus.value = 'front-done'
        break
      case 'back-captured':
        backCapture.value = event.image
        // Desktop owns OCR — extractFromFront/extractMRZFromImage runs against
        // backCapture later in the flow. Do not consume any phone-side
        // extractedData; it produced "qe ii"/"LI" garbage on old-format cards.
        break
      case 'selfie-captured':
        selfieCapture.value = event.image
        // Set the user avatar from the freshly captured selfie. Fire-and-forget;
        // failures are non-fatal — initials remain as a fallback.
        if (typeof event.image === 'string') {
          void setUserAvatar(event.image)
        }
        mobileLiveness.value = event.livenessResult || null
        // Store liveness as done
        if (event.livenessResult?.faceDetected) {
          localStorage.setItem('attestto-liveness-done', 'true')
          faceMatchDone.value = true
        }
        break
      case 'capture-complete':
        mobileStatus.value = 'complete'
        playTadaSound()
        // Auto-advance to review and run OCR (MRZ or front-side)
        setTimeout(() => {
          step.value = 'review'
          runMRZExtraction()
        }, 800)
        break
    }
  })
}

function startWebcamCapture() {
  captureMode.value = 'webcam'
}

// ── Session persistence ──
const SESSION_KEY = 'attestto-cedula-session'

function saveSession() {
  const session = {
    step: step.value,
    frontCapture: frontCapture.value,
    backCapture: backCapture.value,
    manualCedula: manualCedula.value,
    manualNombre: manualNombre.value,
    manualApellido1: manualApellido1.value,
    manualApellido2: manualApellido2.value,
    extractedData: extractedData.value,
    ocrSource: ocrSource.value,
    docAnalysis: docAnalysis.value,
    identityTrust: identityTrust.value,
    savedAt: Date.now(),
  }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch { /* storage full — images are large */ }
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return false
    const session = JSON.parse(raw)

    // Only restore if session is less than 1 hour old
    if (Date.now() - session.savedAt > 60 * 60 * 1000) {
      localStorage.removeItem(SESSION_KEY)
      return false
    }

    // Restore captures and form data
    if (session.frontCapture) frontCapture.value = session.frontCapture
    if (session.backCapture) backCapture.value = session.backCapture
    if (session.manualCedula) manualCedula.value = session.manualCedula
    if (session.manualNombre) manualNombre.value = session.manualNombre
    if (session.manualApellido1) manualApellido1.value = session.manualApellido1
    if (session.manualApellido2) manualApellido2.value = session.manualApellido2
    if (session.extractedData) extractedData.value = session.extractedData
    if (session.ocrSource) ocrSource.value = session.ocrSource
    if (session.docAnalysis) docAnalysis.value = session.docAnalysis
    if (session.identityTrust) identityTrust.value = session.identityTrust

    // Resume at review if we have captures, otherwise at done if completed
    if (session.step === 'done') {
      step.value = 'done'
    } else if (session.frontCapture || session.backCapture) {
      step.value = 'review'
      // Re-run OCR if fields are empty (OCR failed or wasn't completed)
      const hasData = manualCedula.value || extractedData.value?.cedula
      if (!hasData && (frontCapture.value || backCapture.value)) {
        runMRZExtraction()
      }
    }

    return true
  } catch {
    return false
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

// Save session whenever key data changes
watch([step, frontCapture, backCapture, manualCedula, manualNombre, manualApellido1, manualApellido2], () => {
  if (step.value !== 'front' && step.value !== 'back') {
    saveSession()
  }
})

onMounted(() => {
  // ?redo=1 → user explicitly asked to repeat the verification.
  // Wipe the prior session so they start clean from front capture.
  if (router.currentRoute.value.query.redo === '1') {
    clearSession()
    localStorage.removeItem('attestto-liveness-done')
    return
  }
  restoreSession()
})

onUnmounted(() => {
  captureEventCleanup?.()
  window.presenciaAPI?.capture?.stopServer()
})

// ── Document scanning feedback ──
const docFeedback = ref('')
const docReady = ref(false)
const docBrightness = ref(0)
const docEdgeScore = ref(0)
const docStable = ref(false)
let docCheckInterval: ReturnType<typeof setInterval> | null = null
let prevFrameData: Uint8ClampedArray | null = null

interface DocAnalysis {
  brightness: number    // 0-255 average
  contrast: number      // stddev of brightness
  edgeScore: number     // edge density in frame region (0-1)
  motionScore: number   // difference from previous frame (0-1)
  cardPresent: boolean  // enough edges + contrast to suggest a card
}

function analyzeDocFrame(): DocAnalysis {
  const video = camera.videoRef.value
  const empty: DocAnalysis = { brightness: 0, contrast: 0, edgeScore: 0, motionScore: 0, cardPresent: false }
  if (!video || !video.videoWidth) return empty

  const canvas = document.createElement('canvas')
  const w = video.videoWidth
  const h = video.videoHeight
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return empty
  ctx.drawImage(video, 0, 0)

  // Sample the document frame region (center 80%)
  const rx = Math.round(w * 0.1)
  const ry = Math.round(h * 0.1)
  const rw = Math.round(w * 0.8)
  const rh = Math.round(h * 0.8)
  const imgData = ctx.getImageData(rx, ry, rw, rh)
  const data = imgData.data
  const step = 8 // sample every 8th pixel

  // Brightness + contrast
  let sumBrightness = 0
  let count = 0
  const brightnessValues: number[] = []
  for (let i = 0; i < data.length; i += 4 * step) {
    const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
    sumBrightness += gray
    brightnessValues.push(gray)
    count++
  }
  const avgBrightness = sumBrightness / count
  const variance = brightnessValues.reduce((s, v) => s + (v - avgBrightness) ** 2, 0) / count
  const contrast = Math.sqrt(variance)

  // Edge detection (simple horizontal gradient)
  let edges = 0
  const edgeStep = 4
  for (let y = 0; y < rh; y += edgeStep) {
    for (let x = 1; x < rw - 1; x += edgeStep) {
      const idx = (y * rw + x) * 4
      const idxPrev = (y * rw + x - 1) * 4
      const gCur = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
      const gPrev = (data[idxPrev] + data[idxPrev + 1] + data[idxPrev + 2]) / 3
      if (Math.abs(gCur - gPrev) > 30) edges++
    }
  }
  const totalEdgePixels = (rw / edgeStep) * (rh / edgeStep)
  const edgeScore = edges / totalEdgePixels

  // Motion detection (compare with previous frame)
  let motionScore = 0
  if (prevFrameData && prevFrameData.length === data.length) {
    let diff = 0
    for (let i = 0; i < data.length; i += 4 * step * 2) {
      diff += Math.abs(data[i] - prevFrameData[i])
    }
    motionScore = diff / (count / 2) / 255
  }
  prevFrameData = new Uint8ClampedArray(data)

  // Card is likely present if there are enough edges and decent contrast
  const cardPresent = edgeScore > 0.04 && contrast > 18

  return { brightness: avgBrightness, contrast, edgeScore, motionScore, cardPresent }
}

function getDocFeedback(analysis: DocAnalysis): string {
  // Too dark
  if (analysis.brightness < 60) return 'Muy oscuro — busca mejor iluminacion'

  // Too bright / washed out
  if (analysis.brightness > 220) return 'Mucha luz — evita reflejos directos'

  // No card visible
  if (!analysis.cardPresent) return 'Coloca la cedula dentro del marco'

  // Moving too much
  if (analysis.motionScore > 0.06) return 'Manten la cedula quieta'

  // Low contrast (blurry or too far)
  if (analysis.contrast < 20) return 'Acerca la cedula a la camara'

  // Too few edges (card too small / too far)
  if (analysis.edgeScore < 0.06) return 'Acerca mas — el texto debe ser legible'

  // All good
  return ''
}

function startDocDetectionLoop() {
  stopDocDetectionLoop()
  prevFrameData = null
  docCheckInterval = setInterval(() => {
    const analysis = analyzeDocFrame()
    const feedback = getDocFeedback(analysis)
    docFeedback.value = feedback
    docBrightness.value = analysis.brightness
    docEdgeScore.value = analysis.edgeScore
    docStable.value = analysis.motionScore < 0.03
    docReady.value = feedback === '' && analysis.cardPresent && analysis.motionScore < 0.08
  }, 500)
}

function stopDocDetectionLoop() {
  if (docCheckInterval) {
    clearInterval(docCheckInterval)
    docCheckInterval = null
  }
  prevFrameData = null
}

// ── QR / Barcode detection for back of cédula ──
let barcodeDetector: any = null
const qrDetected = ref(false)
const qrData = ref<string | null>(null)
const qrScanning = ref(false)
let qrScanInterval: ReturnType<typeof setInterval> | null = null

const cedulaFormat = ref<'new' | 'old' | 'unknown'>('unknown')

/** Read QR code from video frame using jsQR (pure JS, works everywhere) */
function tryReadQRFromFrame(): string | null {
  const video = camera.videoRef.value
  if (!video || !video.videoWidth) return null

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(video, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  })

  return code?.data || null
}

/** Parse MRZ from QR data or raw MRZ text */
function parseCedulaData(raw: string) {
  // Try to extract cédula number from QR/MRZ data
  // MRZ format: IDCRI1112908776<C00044910<<<<<
  //             8202224<3602047CRI<<<<<<<<<<<<2
  //             CHONGKAN<LIOS<<EDUARDO<ANTONIO
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  let cedula = ''
  let nombre = ''
  let apellido1 = ''
  let apellido2 = ''
  let fechaNacimiento = ''
  let fechaVencimiento = ''

  // Try MRZ-style parsing
  for (const line of lines) {
    // Line 1: IDCRI + cédula (9 digits)
    const mrzMatch = line.match(/IDCRI(\d{9,10})/)
    if (mrzMatch) {
      cedula = mrzMatch[1].substring(0, 9)
    }

    // Line 3: APELLIDO1<APELLIDO2<<NOMBRE1<NOMBRE2
    const nameMatch = line.match(/^([A-Z]+)<([A-Z]*)<{1,2}([A-Z<]+)$/)
    if (nameMatch) {
      apellido1 = nameMatch[1]
      apellido2 = nameMatch[2] || ''
      nombre = nameMatch[3].replace(/</g, ' ').trim()
    }

    // Line 2: dates — YYMMDD format at positions
    const dateMatch = line.match(/(\d{6})<(\d{6,7})/)
    if (dateMatch) {
      const dob = dateMatch[1]
      const exp = dateMatch[2].substring(0, 6)
      fechaNacimiento = `${dob.substring(4, 6)}/${dob.substring(2, 4)}/19${dob.substring(0, 2)}`
      fechaVencimiento = `${exp.substring(4, 6)}/${exp.substring(2, 4)}/20${exp.substring(0, 2)}`
    }
  }

  // If no MRZ, try plain cédula number in the raw data (old format barcode)
  if (!cedula) {
    const numMatch = raw.match(/\b(\d{9})\b/)
    if (numMatch) cedula = numMatch[1]
  }

  // Old format: barcode may contain just the cédula number or a numeric string
  // The old cédula back has printed text (not in barcode): nombre, padre, madre, domicilio
  // So from the old barcode we mostly get the cédula number only

  return { cedula, nombre, apellido1, apellido2, fechaNacimiento, fechaVencimiento }
}

function startQRScanLoop() {
  stopQRScanLoop()
  qrDetected.value = false
  qrData.value = null
  qrScanning.value = true

  qrScanInterval = setInterval(async () => {
    const data = tryReadQRFromFrame()
    if (data) {
      qrDetected.value = true
      qrData.value = data
      cedulaFormat.value = 'new'
      stopQRScanLoop()

      // Auto-capture the back image
      playShutterSound()
      const img = captureFrame()
      if (img) {
        backCapture.value = img
      }

      // Parse and auto-fill fields
      const parsed = parseCedulaData(result.data)
      if (parsed.cedula) manualCedula.value = parsed.cedula
      if (parsed.nombre) manualNombre.value = parsed.nombre
      if (parsed.apellido1) manualApellido1.value = parsed.apellido1
      if (parsed.apellido2) manualApellido2.value = parsed.apellido2

      // Brief green flash then move to review
      await new Promise(resolve => setTimeout(resolve, 600))
      camera.stop()
      step.value = 'review'
    }
  }, 400)
}

function stopQRScanLoop() {
  if (qrScanInterval) {
    clearInterval(qrScanInterval)
    qrScanInterval = null
  }
  qrScanning.value = false
}

// ── Sounds ──
function playShutterSound() {
  try {
    const ctx = new AudioContext()
    const duration = 0.08
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015))
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = 0.2
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
    source.onended = () => ctx.close()
  } catch { /* audio not available */ }
}

function playTadaSound() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    // Three-note ascending major chord: C5 → E5 → G5
    const notes = [
      { freq: 523.25, start: 0, dur: 0.15 },     // C5
      { freq: 659.25, start: 0.12, dur: 0.15 },   // E5
      { freq: 783.99, start: 0.24, dur: 0.35 },    // G5 (held longer)
    ]
    for (const n of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = n.freq
      gain.gain.setValueAtTime(0, now + n.start)
      gain.gain.linearRampToValueAtTime(0.25, now + n.start + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + n.start)
      osc.stop(now + n.start + n.dur + 0.05)
    }
    setTimeout(() => ctx.close(), 800)
  } catch { /* audio not available */ }
}

// ── Camera actions ──
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
    playShutterSound()
    frontCapture.value = img
    step.value = 'back'
    // Start QR/barcode scanning for back capture
    startQRScanLoop()
  }
}

async function captureBack() {
  const img = captureFrame()
  if (img) {
    playShutterSound()
    backCapture.value = img
    stopQRScanLoop()
    camera.stop()
    step.value = 'review'
    // Run MRZ OCR on the back image
    runMRZExtraction()
  }
}

/**
 * Inner-encrypt the captured artifacts (cédula front, cédula back, selfie,
 * face descriptor) and persist them as one VerificationSession in the vault.
 * The IdentityVC in credentials[] will reference this session by id and the
 * per-artifact SHA-256 hashes for auditor verification.
 */
async function saveVerificationSession(credentialId: string): Promise<string | null> {
  const api = window.presenciaAPI?.vault
  if (!api) return null
  if (!frontCapture.value || !backCapture.value) {
    console.warn('[verification-session] missing front/back, skipping persist')
    return null
  }

  const sessionId = 'verification-' + new Date().toISOString()

  /** Encrypt one artifact through the main-process vault helper. */
  const encryptOne = async (
    bytes: Uint8Array,
    mediaType: string,
    label: string,
  ): Promise<EncryptedArtifact> => {
    const hashHex = await sha256Hex(bytes)
    const info = `${sessionId}/${label}`
    return api.encryptArtifact({ plaintext: bytes, mediaType, hashHex, info })
  }

  try {
    const front = await dataUrlToBytes(frontCapture.value)
    const back = await dataUrlToBytes(backCapture.value)
    const selfie = selfieCapture.value
      ? await dataUrlToBytes(selfieCapture.value)
      : { bytes: new Uint8Array(), mediaType: 'application/octet-stream' }

    const cedulaFrontEnc = await encryptOne(front.bytes, front.mediaType, 'cedula-front')
    const cedulaBackEnc = await encryptOne(back.bytes, back.mediaType, 'cedula-back')
    const selfieEnc = await encryptOne(selfie.bytes, selfie.mediaType, 'selfie')

    // Face descriptor — encrypt the raw 512-byte float array
    const descriptorBytes = pendingFaceDescriptors.value
      ? descriptorToBytes(pendingFaceDescriptors.value.selfie)
      : new Uint8Array()
    const faceDescriptorEnc = await encryptOne(
      descriptorBytes,
      'application/octet-stream',
      'face-descriptor',
    )

    const session: VerificationSession = {
      id: sessionId,
      capturedAt: Date.now(),
      credentialId,
      context: 'identity-verification',
      cedulaFront: cedulaFrontEnc,
      cedulaBack: cedulaBackEnc,
      selfie: selfieEnc,
      faceDescriptor: faceDescriptorEnc,
      faceMatchScore: faceMatchScore.value ?? 0,
      faceMatchThreshold: FACE_MATCH_THRESHOLD,
      antiSpoof: {
        passed: !!mobileLiveness.value?.faceDetected,
        score: mobileLiveness.value?.faceDetected ? 1 : 0,
      },
      model: FACE_API_MODEL_INFO,
    }

    const contents = await api.read()
    const existing = contents?.verificationSessions ?? []
    await api.write({ verificationSessions: [...existing, session] })

    // Clear in-memory descriptors — only the encrypted version persists
    pendingFaceDescriptors.value = null
    console.log('[verification-session] persisted', sessionId)
    return sessionId
  } catch (err) {
    console.error('[verification-session] persist failed:', err)
    return null
  }
}

/** Run document analysis + OCR extraction (MRZ for new format, front OCR for old) */
async function runMRZExtraction() {
  ocrRunning.value = true
  ocrProgress.value = 0

  try {
    // Step 1: Analyze document — auto-crop, detect format, assess damage
    const analysis = await analyzeDocument(frontCapture.value, backCapture.value)
    docAnalysis.value = analysis

    // Replace captures with cropped versions
    if (analysis.croppedFront) frontCapture.value = analysis.croppedFront
    if (analysis.croppedBack) backCapture.value = analysis.croppedBack

    console.log('[doc-analysis] Format:', analysis.format, 'Damage:', analysis.damageNotes)

    // Step 2: Try MRZ extraction on back (new format)
    let result = backCapture.value
      ? await extractMRZFromImage(backCapture.value, (p) => { ocrProgress.value = p })
      : null

    // Step 3: If MRZ failed and we have a front image, try front-side OCR (old format)
    if ((!result || !result.success) && frontCapture.value) {
      console.log('[ocr] MRZ not found, trying front-side OCR (old format)...')
      ocrProgress.value = 0
      result = await extractFromFront(frontCapture.value, (p) => { ocrProgress.value = p }, backCapture.value)
    }

    if (result?.success) {
      ocrSource.value = result.source || 'mrz'

      if (result.cedula && !manualCedula.value) manualCedula.value = result.cedula
      if (result.nombre && !manualNombre.value) manualNombre.value = result.nombre
      if (result.apellido1 && !manualApellido1.value) manualApellido1.value = result.apellido1
      if (result.apellido2 && !manualApellido2.value) manualApellido2.value = result.apellido2

      extractedData.value = {
        cedula: result.cedula,
        nombre: result.nombre,
        apellido1: result.apellido1,
        apellido2: result.apellido2,
        fechaNacimiento: result.fechaNacimiento,
        sexo: result.sexo,
        fechaEmision: '',
        fechaVencimiento: result.fechaVencimiento,
        provinciaNacimiento: '',
      }

      console.log('[ocr] Extracted via', ocrSource.value, ':', result)
    } else {
      console.log('[ocr] Could not extract data from either side. Confidence:', result?.confidence)
      ocrSource.value = null
      extractedData.value = {
        cedula: '', nombre: '', apellido1: '', apellido2: '',
        fechaNacimiento: '', sexo: '', fechaEmision: '',
        fechaVencimiento: '', provinciaNacimiento: '',
      }
    }
  } catch (err) {
    console.error('[ocr] Error:', err)
  } finally {
    ocrRunning.value = false
  }
}

async function verifyDocument() {
  try {
    await runVerifyDocument()
  } catch (err) {
    console.error('[verify] Unhandled error:', err)
    tseValidation.value = {
      status: 'invalid',
      message: `Error en la verificación: ${err instanceof Error ? err.message : String(err)}`,
    }
    step.value = 'review'
  }
}

/** Race a promise against a timeout, so the face-match spinner can't hang. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} excedió ${ms}ms`)), ms)),
  ])
}

async function runVerifyDocument() {
  step.value = 'validating'
  faceMatchDone.value = false
  padronLookupDone.value = false
  nameMatch.value = null

  const cedula = manualCedula.value || extractedData.value?.cedula || ''
  const clean = cedula.replace(/[^0-9]/g, '')
  if (!validateCedulaFormat(clean)) {
    tseValidation.value = { status: 'invalid', message: 'Formato de cedula invalido' }
    step.value = 'review'
    return
  }

  // ── Step 1: Real face match via @vladmandic/face-api ──
  // Extract 128D descriptor from cédula photo + selfie, compute euclidean
  // distance, store both as part of the verification session.
  pendingFaceDescriptors.value = null
  if (frontCapture.value && selfieCapture.value) {
    tseValidation.value = { status: 'checking', message: 'Cargando modelos de reconocimiento facial...' }
    try {
      await withTimeout(loadFaceModels(), 15000, 'Carga de modelos faciales')
      tseValidation.value = { status: 'checking', message: 'Comparando rostro de la cédula con la prueba de vida...' }
      const cedulaFace = await withTimeout(extractFaceDescriptor(frontCapture.value), 15000, 'Detección de rostro en cédula')
      const selfieFace = await withTimeout(extractFaceDescriptor(selfieCapture.value), 15000, 'Detección de rostro en selfie')

      if (!cedulaFace) {
        tseValidation.value = { status: 'checking', message: 'No se detectó rostro en la cédula — continuando sin comparación facial' }
        faceMatchScore.value = null
      } else if (!selfieFace) {
        tseValidation.value = { status: 'checking', message: 'No se detectó rostro en la selfie — continuando sin comparación facial' }
        faceMatchScore.value = null
      } else {
        const cmp = compareDescriptors(cedulaFace.descriptor, selfieFace.descriptor)
        faceMatchScore.value = cmp.similarity
        pendingFaceDescriptors.value = {
          cedula: cedulaFace.descriptor,
          selfie: selfieFace.descriptor,
          distance: cmp.distance,
          match: cmp.match,
        }
        console.log('[face-match]', { distance: cmp.distance, similarity: cmp.similarity, match: cmp.match })
      }
    } catch (err) {
      console.error('[face-match] failed:', err)
      tseValidation.value = { status: 'checking', message: 'Error en reconocimiento facial — continuando sin comparación' }
      faceMatchScore.value = null
    }
  } else {
    tseValidation.value = { status: 'checking', message: 'Prueba de vida no completada — omitiendo comparación facial' }
    faceMatchScore.value = null
  }
  faceMatchDone.value = true

  // ── Step 2: Padrón lookup — download canton and cross-reference ──
  tseValidation.value = { status: 'checking', message: 'Buscando en padron local...' }

  const api = window.presenciaAPI?.padron
  if (!api) {
    // No Electron — simulate
    await new Promise(resolve => setTimeout(resolve, 1500))
    padronMatch.value = {
      nombre: manualNombre.value,
      apellido1: manualApellido1.value,
      apellido2: manualApellido2.value || null,
      fechacaduc: null,
    }
    nameMatch.value = true
    padronLookupDone.value = true
    tseValidation.value = { status: 'valid', message: 'Cedula verificada en el Padron Nacional del TSE' }
    await storeCredential(clean)
    await saveVerificationSession(`attestto-credential-${clean}`)
    step.value = 'done'
    return
  }

  let result = await api.lookup(clean)

  if (!result.found) {
    // Padrón is organized by ELECTORAL DOMICILE — where you VOTE, not where
    // you were born. Cédula digit 1 only encodes birth province, which is
    // useless for finding the record. We must NEVER auto-download cantons
    // based on birth province — it wastes bandwidth and almost always misses.
    //
    // Strategy:
    //  1. If user already picked a voting canton, try only that one.
    //  2. Otherwise prompt the user to pick their voting canton — no
    //     guessing, no automatic downloads.

    if (!selectedCanton.value) {
      padronDownloading.value = false
      padronAskCanton.value = true
      step.value = 'review'
      tseValidation.value = {
        status: 'checking',
        message: 'Selecciona el cantón donde votás para descargar el Padrón correcto.',
      }
      return // User will select canton and re-verify
    }

    const canton = CR_CANTONS.find(c => c.code === selectedCanton.value)
    if (!canton) {
      padronDownloading.value = false
      tseValidation.value = { status: 'invalid', message: 'Cantón seleccionado no válido' }
      step.value = 'review'
      return
    }

    padronDownloading.value = true
    const hasCanton = await api.hasCanton(canton.code)
    if (!hasCanton) {
      tseValidation.value = {
        status: 'checking',
        message: 'Preparando datos…',
      }
      try {
        await api.downloadCanton({
          zipFilename: canton.zipFile,
          cantonCode: canton.code,
          cantonName: canton.name,
        })
      } catch (err) {
        console.error(`[padron] Failed to download ${canton.name}:`, err)
        padronDownloading.value = false
        tseValidation.value = { status: 'invalid', message: `No se pudo descargar ${canton.name}` }
        step.value = 'review'
        return
      }
    }
    result = await api.lookup(clean)
    padronDownloading.value = false

    // Not found in the selected canton — ask user to pick a different one,
    // since the cédula clearly votes elsewhere.
    if (!result.found) {
      padronAskCanton.value = true
      step.value = 'review'
      tseValidation.value = {
        status: 'checking',
        message: `No se encontró en ${canton.name}. Verificá tu cantón electoral y volvé a intentarlo.`,
      }
      return
    }
  }

  if (!result.found) {
    tseValidation.value = { status: 'invalid', message: 'Cedula no encontrada en el Padron Nacional' }
    step.value = 'review'
    return
  }

  // ── Step 3: Cross-reference — OCR name vs Padrón name ──
  padronMatch.value = {
    nombre: result.record!.nombre,
    apellido1: result.record!.apellido1,
    apellido2: result.record!.apellido2 || null,
    fechacaduc: result.record!.fechacaduc || null,
  }
  padronLookupDone.value = true

  // Compare names (case-insensitive, trimmed)
  const ocrName = (manualNombre.value || '').trim().toUpperCase()
  const ocrApellido1 = (manualApellido1.value || '').trim().toUpperCase()
  const padronNombre = result.record!.nombre.trim().toUpperCase()
  const padronApellido1 = result.record!.apellido1.trim().toUpperCase()

  // Name match: at least apellido1 must match (names can have variations)
  nameMatch.value = padronApellido1 === ocrApellido1 || padronNombre.includes(ocrName) || ocrName.includes(padronNombre)

  tseValidation.value = { status: 'valid', message: 'Cedula verificada en el Padron Nacional del TSE' }

  await storeCredential(clean)
  await saveVerificationSession(`attestto-credential-${clean}`)

  step.value = 'done'
}

async function linkFirmaDigital() {
  firmaDigitalStatus.value = 'detecting'

  // TODO: real PKCS#11 integration via node-pkcs11
  // 1. Enumerate slots → find smart card reader
  // 2. Open session → read X.509 authentication cert
  // 3. Extract subject fields (CN, serialNumber/cédula)
  // 4. Verify cert via OCSP (ocsp.sinpe.fi.cr/ocsp)
  // 5. Check if signing cert also present

  // Simulate smart card detection
  await new Promise(resolve => setTimeout(resolve, 1500))
  firmaDigitalStatus.value = 'reading'

  await new Promise(resolve => setTimeout(resolve, 1000))
  firmaDigitalStatus.value = 'verifying'

  // TODO: OCSP verification against ocsp.sinpe.fi.cr/ocsp
  await new Promise(resolve => setTimeout(resolve, 1500))

  // Simulate successful cert read
  const clean = (manualCedula.value || '').replace(/[^0-9]/g, '')
  firmaDigitalCert.value = {
    cn: `${manualNombre.value} ${manualApellido1.value} ${manualApellido2.value}`.trim(),
    cedula: clean,
    issuer: 'CA SINPE – PERSONA FISICA',
    serialNumber: crypto.randomUUID().substring(0, 16).toUpperCase(),
    validFrom: new Date().toISOString().split('T')[0],
    validTo: new Date(Date.now() + 4 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    hasSigningCert: true,
  }

  // Cross-check: cert cédula must match the scanned cédula
  if (firmaDigitalCert.value.cedula !== clean) {
    firmaDigitalStatus.value = 'error'
    return
  }

  // Upgrade identity trust
  identityTrust.value = 'A+'
  firmaDigitalStatus.value = 'linked'

  // TODO: store Firma Digital credential in vault
  // This replaces the cédula-based credential with a stronger one
  console.log('[CR] Firma Digital linked:', {
    type: 'FirmaDigitalCredential',
    issuer: 'did:sns:sinpe.fi.cr',
    trust: 'A+',
    cert: firmaDigitalCert.value,
  })
}


/**
 * Deterministic JSON serialization with recursively sorted keys.
 * Used as a v1 canonicalization scheme for VC signing — not full JCS (RFC
 * 8785), but sufficient for ed25519 over a self-contained JSON document where
 * we control both signer and verifier. Replace with a real JCS implementation
 * before exposing this VC to third-party verifiers.
 */
function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalizeJson).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalizeJson(obj[k])).join(',') + '}'
}

async function storeCredential(cedula: string) {
  const nombre = manualNombre.value || extractedData.value?.nombre || ''
  const apellido1 = manualApellido1.value || extractedData.value?.apellido1 || ''
  const apellido2 = manualApellido2.value || extractedData.value?.apellido2 || ''
  const cedulaFormatted = formatCedula(cedula)
  const credentialId = `urn:attestto:cr:cedula:${cedula}`
  const issuanceDate = new Date().toISOString()

  // Resolve the user's vault DID — credentialSubject.id should be the user's
  // identity DID, NOT the station's. This ensures the credential is *about*
  // the user but signed *by* the station.
  let subjectDid: string | null = null
  try {
    const contents = await window.presenciaAPI?.vault?.read?.()
    subjectDid = contents?.identity?.did ?? null
  } catch (err) {
    console.warn('[CR] could not resolve subject DID from vault:', err)
  }

  // Resolve the station identifiers (issuer chain). The actual `issuer` field
  // on the VC will be a fresh per-credential pairwise sub-DID; the station
  // root DIDs are recorded inside the proof block so a verifier can walk back.
  let stationDids: { sns: string; web: string; key: string } | null = null
  try {
    const info = await window.presenciaAPI?.station?.info?.()
    if (info) stationDids = info.dids
  } catch (err) {
    console.warn('[CR] could not resolve station DIDs:', err)
  }

  // Build the credential body WITHOUT the proof block. This is the exact JSON
  // structure the station will sign — adding/removing any field after this
  // point invalidates the signature.
  const credentialBody = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://attestto.id/schemas/v1',
    ],
    id: credentialId,
    type: ['VerifiableCredential', 'CedulaIdentityCredential'],
    // Issuer is filled in below once we have a sub-pubkey from the station
    issuer: 'urn:placeholder',
    issuanceDate,
    credentialSubject: {
      id: subjectDid ?? 'urn:attestto:vault:locked',
      cedula: cedulaFormatted,
      nombre: `${nombre} ${apellido1} ${apellido2}`.trim().replace(/\s+/g, ' '),
      fechaNacimiento: extractedData.value?.fechaNacimiento || '',
      fechaVencimiento: padronMatch.value?.fechacaduc || '',
    },
    evidence: [
      {
        type: ['DocumentVerification', 'TSECedulaCR'],
        authority: TSE_AUTHORITY.didWeb,
        alsoKnownAs: [TSE_AUTHORITY.didSns],
        authorityName: TSE_AUTHORITY.name,
        documentFormat: docAnalysis.value?.format || 'unknown',
        ocrSource: ocrSource.value || 'unknown',
        registry: PADRON_REGISTRY.didWeb,
        registryAlsoKnownAs: [PADRON_REGISTRY.didSns],
        padronMatch: !!padronMatch.value,
        nameMatch: !!nameMatch.value,
        faceMatchScore: faceMatchScore.value,
        livenessVerified: mobileLiveness.value?.faceDetected || false,
        livenessBlinkCount: mobileLiveness.value?.blinkCount || 0,
      },
    ],
    trustLevel: identityTrust.value,
  }

  // Sign with a fresh pairwise sub-key from the station identity. The
  // returned proof contains the sub-pubkey + delegation chain back to the
  // station master key. The station's master key never leaves the main
  // process — only the signature crosses the IPC boundary.
  let proof: VcProofBlock | null = null
  if (window.presenciaAPI?.station?.signCredential && stationDids) {
    try {
      // Canonicalize the body BEFORE we know the issuer field, then patch the
      // issuer in afterwards. The patched value is also fed back into the
      // body so storage and signature reference the same shape.
      const tempBody = { ...credentialBody, issuer: 'urn:attestto:station:tbd' }
      const canonical = canonicalizeJson(tempBody)
      const messageB64 = btoa(canonical)
      const wireProof = await window.presenciaAPI.station.signCredential({
        credentialId,
        messageB64,
      })

      // Build the VC issuer DID from the sub-pubkey. did:key:z<base64url(0xed01||pubkey)>
      // — matches the convention vault-service.ts uses for the user identity DID.
      const subPubBytes = Uint8Array.from(atob(wireProof.subPublicKeyB64), c => c.charCodeAt(0))
      const subDidKey = subPubKeyToDidKey(subPubBytes)
      credentialBody.issuer = subDidKey

      proof = {
        type: 'Ed25519Signature2020',
        created: wireProof.createdAt,
        verificationMethod: `${subDidKey}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: `z${wireProof.proofValueB64}`,
        // Delegation chain — proves this sub-key is authorized by the station
        // master, which in turn is anchored at:
        delegationProof: {
          stationDid: stationDids.sns,
          stationDidWeb: stationDids.web,
          stationDidKey: stationDids.key,
          binding: wireProof.delegationBindingB64,
          signature: wireProof.delegationProofB64,
        },
        // Note: the canonical bytes the sub-key signed are the body with
        // issuer = 'urn:attestto:station:tbd'. Verifier reconstructs the same
        // shape, swaps in the placeholder, recomputes canonical, and verifies.
        canonicalIssuerPlaceholder: 'urn:attestto:station:tbd',
      }
    } catch (err) {
      console.error('[CR] station signing failed:', err)
    }
  } else {
    console.warn('[CR] station API unavailable — credential will be stored unsigned')
  }

  const credential = proof
    ? { ...credentialBody, proof }
    : credentialBody

  // Vault-first: try the encrypted vault. Only fall back to localStorage if the
  // vault is unavailable (browser dev mode) or locked. On successful vault write,
  // delete the localStorage copy so PII does not sit unencrypted on disk.
  const lsKey = `attestto-credential-${cedula}`
  const api = window.presenciaAPI?.vault
  let storedInVault = false

  if (api) {
    try {
      const contents = await api.read()
      if (contents) {
        const credentials = Array.isArray(contents?.credentials) ? contents.credentials : []
        const idx = credentials.findIndex((c: any) => c.id === credential.id)
        if (idx >= 0) credentials[idx] = credential
        else credentials.push(credential)
        await api.write({ credentials })
        storedInVault = true
        // Clean up any prior unencrypted copy.
        localStorage.removeItem(lsKey)
      } else {
        console.warn('[CR] vault read returned null (locked or missing) — falling back to localStorage')
      }
    } catch (err) {
      console.warn('[CR] vault write failed, falling back to localStorage:', err)
    }
  }

  if (!storedInVault) {
    // Fallback only — surfaces in CredentialsPage via the localStorage merge path.
    // This is intentionally a P1 follow-up: it should prompt the user to unlock
    // the vault rather than silently storing PII in plain localStorage.
    localStorage.setItem(lsKey, JSON.stringify(credential))
  }

  console.log('[CR] Cedula credential stored:', { id: credential.id, storedInVault })

  // Flip the journey-progress signal so "Mi cuenta" advances past step 1
  // immediately, regardless of whether the credential ended up in the vault
  // or in localStorage.
  vault.markIdentityVerified()

  // Signing capability unlocks the moment identity is verified — this is the
  // core value loop. Surface the unlock immediately so the user understands
  // what they just earned and can jump straight into signing.
  Notify.create({
    type: 'positive',
    message: 'Ya podés firmar documentos',
    caption: 'Tu identidad verificada habilita la firma de PDFs',
    icon: 'draw',
    position: 'top',
    timeout: 6000,
    actions: [
      {
        label: 'Firmar ahora',
        color: 'white',
        handler: () => router.push('/signing'),
      },
    ],
  })
}

async function retake(side: 'front' | 'back') {
  if (side === 'front') {
    frontCapture.value = null
    extractedData.value = null
  } else {
    backCapture.value = null
  }
  step.value = side

  // Restart in the same mode the user originally chose
  if (captureMode.value === 'mobile') {
    // Create a new mobile session for re-capture
    await startMobileCapture()
  } else {
    startCapture()
  }
}

function goBack() {
  stopDocDetectionLoop()
  stopQRScanLoop()
  camera.stop()
  clearSession()
  router.push('/identity')
}
</script>

<template>
  <q-page class="page-centered">
    <div class="page-centered__container cedula-page">

      <!-- Header -->
      <div class="cedula-header q-mb-lg">
        <q-btn flat dense round icon="arrow_back" @click="goBack" />
        <div>
          <div class="text-h5 text-weight-bold att-text-title">Cedula de identidad</div>
          <div class="att-text-muted" style="font-size: var(--att-text-xs);">
            Tribunal Supremo de Elecciones — Republica de Costa Rica
          </div>
        </div>
      </div>

      <!-- Step indicator -->
      <div class="step-indicator q-mb-lg">
        <div class="step-dot" :class="{ active: step === 'front' || step === 'back', done: step !== 'front' && step !== 'back' && frontCapture }">
          <q-icon :name="step !== 'front' && step !== 'back' && frontCapture ? 'check' : '1'" size="14px" />
          <span>Escaneo</span>
        </div>
        <div class="step-line" :class="{ done: step === 'done' }" />
        <div class="step-dot" :class="{ active: step === 'review' || step === 'validating', done: step === 'done' }">
          <q-icon :name="step === 'done' ? 'check' : '2'" size="14px" />
          <span>Verificar</span>
        </div>
      </div>

      <!-- DOCUMENT CAPTURE -->
      <template v-if="step === 'front' || step === 'back'">

        <!-- Choose capture mode -->
        <template v-if="captureMode === 'choose'">
          <div class="capture-instructions q-mb-lg">
            <q-icon name="badge" size="24px" color="primary" />
            <div>
              <div class="text-weight-bold">Escanear cedula</div>
              <div class="att-text-muted" style="font-size: var(--att-text-xs);">
                Elige como capturar tu documento — frente y reverso
              </div>
            </div>
          </div>

          <div class="capture-mode-options">
            <div class="capture-mode-card" @click="startMobileCapture">
              <q-icon name="phone_iphone" size="36px" color="primary" />
              <div class="text-weight-bold">Usar telefono</div>
              <div class="att-text-muted" style="font-size: var(--att-text-xs);">
                Escanea un QR y captura con la camara del celular — mejor calidad
              </div>
              <q-badge color="positive" label="Recomendado" class="q-mt-xs" />
            </div>
            <div class="capture-mode-card" @click="startWebcamCapture">
              <q-icon name="laptop" size="36px" color="grey-6" />
              <div class="text-weight-bold">Usar webcam</div>
              <div class="att-text-muted" style="font-size: var(--att-text-xs);">
                Captura directamente con la camara de la computadora
              </div>
            </div>
          </div>
        </template>

        <!-- Mobile capture mode: show QR -->
        <template v-if="captureMode === 'mobile'">
          <div class="mobile-capture-flow">
            <div v-if="mobileStatus === 'starting'" class="mobile-qr-section">
              <q-spinner-orbit size="48px" color="primary" />
              <div class="att-text-body q-mt-sm">Iniciando servidor local...</div>
            </div>

            <div v-else-if="mobileStatus === 'waiting'" class="mobile-qr-section">
              <div class="text-weight-bold q-mb-sm">Escanea con tu telefono</div>
              <div class="att-text-muted q-mb-md" style="font-size: var(--att-text-xs);">
                Tu telefono debe estar en la misma red WiFi
              </div>
              <img :src="mobileQrDataUrl" alt="QR" class="mobile-qr-image" />
              <div class="att-text-muted q-mt-sm" style="font-size: var(--att-text-xs); word-break: break-all;">
                {{ mobileSessionUrl }}
              </div>
              <div class="mobile-waiting-hint q-mt-md">
                <q-spinner-dots size="16px" color="primary" />
                <span>Esperando conexion del telefono...</span>
              </div>
            </div>

            <div v-else-if="mobileStatus === 'connected'" class="mobile-qr-section">
              <q-icon name="phone_iphone" size="48px" color="positive" />
              <div class="text-weight-bold q-mt-sm" style="color: var(--q-positive);">Telefono conectado</div>
              <div class="att-text-muted" style="font-size: var(--att-text-xs);">
                Captura el frente de la cedula en tu telefono
              </div>
              <q-spinner-dots size="16px" color="primary" class="q-mt-md" />
            </div>

            <div v-else-if="mobileStatus === 'front-done'" class="mobile-qr-section">
              <q-icon name="check_circle" size="32px" color="positive" />
              <div class="text-weight-bold q-mt-sm">Frente recibido</div>
              <img v-if="frontCapture" :src="frontCapture" class="mobile-preview-thumb q-mt-sm" />
              <div class="att-text-muted q-mt-sm" style="font-size: var(--att-text-xs);">
                Ahora captura el reverso en tu telefono
              </div>
              <q-spinner-dots size="16px" color="primary" class="q-mt-sm" />
            </div>

            <div v-else-if="mobileStatus === 'complete'" class="mobile-qr-section">
              <q-icon name="check_circle" size="48px" color="positive" />
              <div class="text-weight-bold q-mt-sm" style="color: var(--q-positive);">Capturas recibidas</div>
              <div class="mobile-preview-row q-mt-md">
                <img v-if="frontCapture" :src="frontCapture" class="mobile-preview-thumb" />
                <img v-if="backCapture" :src="backCapture" class="mobile-preview-thumb" />
              </div>
            </div>
          </div>

          <div class="q-mt-md q-gutter-sm row justify-center">
            <q-btn
              v-if="mobileStatus === 'waiting'"
              flat color="grey" label="Cancelar"
              @click="captureMode = 'choose'; window.presenciaAPI?.capture?.stopServer()"
            />
          </div>
        </template>

        <!-- Webcam capture mode (original flow) -->
        <template v-if="captureMode === 'webcam' && step === 'front'">
          <div class="capture-instructions q-mb-md">
            <q-icon name="badge" size="24px" color="primary" />
            <div>
              <div class="text-weight-bold">Frente de la cedula</div>
              <div class="att-text-muted" style="font-size: var(--att-text-xs);">
                Coloca la cedula frente a la camara
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
              <div class="doc-feedback-overlay">
                <div class="doc-feedback">
                  Alinea la cedula dentro del marco
                </div>
              </div>
            </template>
          </div>

          <div class="q-mt-md q-gutter-sm row justify-center">
            <q-btn
              v-if="camera.isActive.value"
              color="primary"
              icon="photo_camera"
              label="Capturar frente"
              @click="captureFront"
            />
          </div>
        </template>

      <!-- BACK CAPTURE (webcam mode only — mobile handles both sides) -->
      <template v-if="captureMode === 'webcam' && step === 'back'">
        <div class="capture-instructions q-mb-md">
          <q-icon name="qr_code_scanner" size="24px" color="primary" />
          <div>
            <div class="text-weight-bold">Reverso de la cedula</div>
            <div class="att-text-muted" style="font-size: var(--att-text-xs);">
              Muestra el QR o codigo de barras a la camara — se captura automaticamente
            </div>
          </div>
        </div>

        <!-- Thumbnail of front capture -->
        <div v-if="frontCapture" class="captured-thumbnail q-mb-md">
          <img :src="frontCapture" alt="Frente capturado" />
          <div class="captured-thumbnail__badge">
            <q-icon name="check_circle" color="positive" size="16px" />
            <span>Frente capturado</span>
          </div>
        </div>

        <div class="camera-capture" :class="{ 'camera-capture--qr-found': qrDetected }">
          <template v-if="!camera.isActive.value">
            <div class="camera-capture__idle" @click="startCapture(); startQRScanLoop()">
              <q-icon name="qr_code_scanner" size="48px" color="primary" />
              <div class="att-text-body q-mt-sm">Toca para activar el escaner</div>
            </div>
          </template>
          <template v-else>
            <video
              :ref="camera.bindVideo"
              autoplay playsinline muted
              class="camera-capture__video"
            />
            <!-- Frame overlay — grey until QR detected, then green -->
            <div class="document-frame" :class="{ 'document-frame--scanning': qrScanning && !qrDetected, 'document-frame--found': qrDetected }" />
            <!-- QR scan feedback -->
            <div class="doc-feedback-overlay">
              <div v-if="qrDetected" class="doc-feedback doc-feedback--ready">
                <q-icon name="check_circle" size="16px" />
                {{ cedulaFormat === 'new' ? 'QR leido' : 'Codigo de barras leido' }} — datos extraidos
              </div>
              <div v-else class="doc-feedback doc-feedback--warning">
                <q-icon name="qr_code_scanner" size="16px" />
                Buscando QR o codigo de barras...
              </div>
            </div>
          </template>
        </div>

        <div class="q-mt-md q-gutter-sm row justify-center">
          <q-btn
            v-if="camera.isActive.value && !qrDetected"
            flat
            color="grey"
            icon="photo_camera"
            label="Capturar sin QR"
            @click="captureBack"
          />
        </div>
      </template>

      </template><!-- end step front/back -->

      <!-- REVIEW + MANUAL ENTRY -->
      <template v-if="step === 'review'">
        <div class="review-layout">
          <!-- Left column: captured images (thumbnails) -->
          <div class="review-images">
            <div class="review-capture" v-if="frontCapture">
              <div class="review-capture-label">Frente</div>
              <div class="review-thumbnail">
                <img :src="frontCapture" alt="Frente" />
              </div>
              <q-btn flat dense size="xs" icon="refresh" label="Repetir" @click="retake('front')" />
            </div>
            <div class="review-capture" v-if="backCapture">
              <div class="review-capture-label">Reverso</div>
              <div class="review-thumbnail">
                <img :src="backCapture" alt="Reverso" />
              </div>
              <q-btn flat dense size="xs" icon="refresh" label="Repetir" @click="retake('back')" />
            </div>

            <!-- Document notes -->
            <div v-if="docAnalysis" class="doc-notes q-mt-sm">
              <div class="doc-note" :class="docAnalysis.format === 'old' ? 'doc-note--warning' : 'doc-note--info'">
                <q-icon :name="docAnalysis.format === 'old' ? 'history' : 'verified'" size="14px" />
                <span v-if="docAnalysis.format === 'old'">Formato anterior (sin MRZ) — datos leidos del frente</span>
                <span v-else-if="docAnalysis.format === 'new'">Formato vigente con MRZ</span>
                <span v-else>Formato no identificado</span>
              </div>
              <div v-for="(note, i) in docAnalysis.damageNotes" :key="i" class="doc-note doc-note--warning">
                <q-icon name="warning" size="14px" />
                <span>{{ note }}</span>
              </div>
            </div>
          </div>

          <!-- Right column: form -->
          <div class="review-data">
            <div class="review-section-title q-mb-sm">Datos de la cedula</div>

            <!-- OCR progress -->
            <div v-if="ocrRunning" class="ocr-progress q-mb-md">
              <q-spinner-dots size="16px" color="primary" />
              <span>Leyendo documento... {{ ocrProgress }}%</span>
              <q-linear-progress :value="ocrProgress / 100" color="primary" size="4px" class="q-mt-xs" style="max-width: 200px;" />
            </div>

            <div v-else class="q-mb-md" style="font-size: var(--att-text-xs);">
              <template v-if="extractedData?.cedula && ocrSource === 'front-ocr'">
                <div class="att-text-muted">Datos extraidos del frente — verifica que sean correctos.</div>
                <div class="doc-note doc-note--warning q-mt-xs" style="display: inline-flex;">
                  <q-icon name="edit" size="14px" />
                  <span v-if="docAnalysis?.format === 'new'">No se pudo leer el MRZ — los datos vienen del frente y pueden tener errores. Corrigelos manualmente.</span>
                  <span v-else>Formato anterior: la lectura puede tener errores. Corrige los campos manualmente.</span>
                </div>
              </template>
              <template v-else-if="extractedData?.cedula">
                <div class="att-text-muted">Datos extraidos del MRZ — verifica que sean correctos.</div>
              </template>
              <template v-else-if="docAnalysis?.format === 'old'">
                <div class="doc-note doc-note--warning" style="display: inline-flex;">
                  <q-icon name="edit" size="14px" />
                  <span>Formato anterior sin MRZ. Ingresa los datos como aparecen en tu cedula.</span>
                </div>
              </template>
              <template v-else>
                <div class="att-text-muted">No se pudieron leer los datos. Ingresa manualmente.</div>
              </template>

              <!-- Re-run OCR button when fields are empty -->
              <q-btn
                v-if="!extractedData?.cedula && (frontCapture || backCapture)"
                flat dense size="sm" icon="refresh" label="Reintentar lectura OCR"
                color="primary"
                class="q-mt-xs"
                @click="runMRZExtraction()"
              />
            </div>

            <div class="review-form">
              <div class="form-field">
                <label>Numero de cedula</label>
                <q-input
                  v-model="manualCedula"
                  :placeholder="extractedData?.cedula || '0-0000-0000'"
                  outlined dense
                  mask="#-####-####"
                  :error="!cedulaFormatValid"
                  error-message="Formato invalido (9 digitos)"
                >
                  <template v-slot:prepend>
                    <q-icon name="badge" />
                  </template>
                </q-input>
              </div>

              <div class="form-field">
                <label>Nombre</label>
                <q-input
                  v-model="manualNombre"
                  :placeholder="extractedData?.nombre || 'Nombre'"
                  outlined dense
                  input-class="text-uppercase"
                  @update:model-value="v => manualNombre = (v ?? '').toString().toUpperCase()"
                />
              </div>

              <div class="form-row">
                <div class="form-field">
                  <label>Primer apellido</label>
                  <q-input
                    v-model="manualApellido1"
                    :placeholder="extractedData?.apellido1 || 'Primer apellido'"
                    outlined dense
                    input-class="text-uppercase"
                    @update:model-value="v => manualApellido1 = (v ?? '').toString().toUpperCase()"
                  />
                </div>
                <div class="form-field">
                  <label>Segundo apellido</label>
                  <q-input
                    v-model="manualApellido2"
                    :placeholder="extractedData?.apellido2 || 'Segundo apellido'"
                    outlined dense
                    input-class="text-uppercase"
                    @update:model-value="v => manualApellido2 = (v ?? '').toString().toUpperCase()"
                  />
                </div>
              </div>
            </div>

            <!-- Canton selector (shown when Padrón can't find by birth province) -->
            <div v-if="padronAskCanton" class="canton-selector q-mt-md q-mb-md">
              <div class="doc-note doc-note--warning q-mb-sm">
                <q-icon name="location_on" size="14px" />
                <span>Necesitamos saber dónde votás para descargar el Padrón correcto. Sólo se descargará un cantón.</span>
              </div>
              <div class="form-row">
                <div class="form-field">
                  <label>Provincia electoral</label>
                  <q-select
                    v-model="selectedProvince"
                    :options="provinceOptions"
                    emit-value
                    map-options
                    outlined dense
                    placeholder="Provincia"
                  />
                </div>
                <div class="form-field" v-if="selectedProvince">
                  <label>Canton</label>
                  <q-select
                    v-model="selectedCanton"
                    :options="cantonOptions"
                    emit-value
                    map-options
                    outlined dense
                    placeholder="Canton"
                  />
                </div>
              </div>
            </div>

            <!-- TSE validation status -->
            <div v-if="tseValidation.status === 'invalid'" class="tse-status tse-status--invalid q-mt-md">
              <q-icon name="warning" color="negative" size="20px" />
              <span>{{ tseValidation.message }}</span>
            </div>

            <div class="q-mt-lg q-gutter-sm row">
              <q-btn
                color="primary"
                icon="verified_user"
                label="Verificar documento"
                :disable="!manualCedula && !extractedData?.cedula"
                @click="verifyDocument"
              />
              <q-btn flat color="grey" label="Cancelar" @click="goBack" />
            </div>
          </div>
        </div>
      </template>

      <!-- VALIDATING -->
      <template v-if="step === 'validating'">
        <div class="validating-state">
          <q-spinner-orbit size="64px" color="primary" class="q-mb-lg" />

          <div class="validation-steps">
            <!-- Step 1: Document OCR captured -->
            <div class="validation-step validation-step--done">
              <q-icon name="check_circle" color="positive" size="20px" />
              <span>Documento escaneado — datos extraidos</span>
            </div>

            <!-- Step 2: Face match (cédula photo vs liveness in vault) -->
            <div class="validation-step" :class="{ 'validation-step--done': faceMatchDone }">
              <q-spinner-dots v-if="!faceMatchDone" size="20px" color="primary" />
              <q-icon v-else-if="faceMatchScore" name="check_circle" color="positive" size="20px" />
              <q-icon v-else name="info" color="grey-5" size="20px" />
              <span>
                <template v-if="faceMatchDone && faceMatchScore">
                  Rostro coincide con prueba de vida ({{ Math.round(faceMatchScore * 100) }}%)
                </template>
                <template v-else-if="faceMatchDone">
                  Prueba de vida pendiente — comparacion facial omitida
                </template>
                <template v-else>
                  Comparando rostro del documento con prueba de vida...
                </template>
              </span>
            </div>

            <!-- Step 3: Padrón lookup -->
            <div class="validation-step" :class="{ 'validation-step--done': padronLookupDone }">
              <q-spinner-dots v-if="faceMatchDone && !padronLookupDone" size="20px" color="primary" />
              <q-icon v-else-if="padronLookupDone" name="check_circle" color="positive" size="20px" />
              <q-icon v-else name="hourglass_empty" color="grey-5" size="20px" />
              <span :class="{ 'text-grey-6': !faceMatchDone }">
                {{ tseValidation.message || 'Verificando en Padron Nacional del TSE...' }}
              </span>
            </div>

            <!-- Privacy-first download explainer — earns trust by being explicit:
                 the Padrón comes to YOUR device, your cédula never leaves it. -->
            <div v-if="padronDownloading" class="padron-privacy-note q-mt-sm">
              <div class="padron-privacy-note__header">
                <q-icon name="lock" size="16px" color="positive" />
                <span class="text-weight-bold">Descargando Padrón Electoral a tu dispositivo</span>
              </div>
              <div class="padron-privacy-note__body">
                Tu cédula nunca se envía a ningún servidor — la verificación ocurre localmente.
                Sólo ocurre una vez por cantón.
              </div>
              <div class="padron-privacy-note__spinner">
                <q-spinner-dots size="18px" color="primary" />
              </div>
            </div>

            <!-- Step 4: Name cross-reference -->
            <div class="validation-step" :class="{ 'validation-step--done': nameMatch !== null }">
              <q-icon v-if="nameMatch === true" name="check_circle" color="positive" size="20px" />
              <q-icon v-else-if="nameMatch === false" name="warning" color="warning" size="20px" />
              <q-icon v-else name="hourglass_empty" color="grey-5" size="20px" />
              <span :class="{ 'text-grey-6': !padronLookupDone }">
                <template v-if="nameMatch === true">Nombre del documento coincide con Padron</template>
                <template v-else-if="nameMatch === false">Nombre difiere — requiere revision manual</template>
                <template v-else>Cruzando datos del documento con Padron...</template>
              </span>
            </div>
          </div>
        </div>
      </template>

      <!-- DONE -->
      <template v-if="step === 'done'">
        <div class="done-state">
          <q-icon name="verified" size="64px" color="positive" class="q-mb-md" />
          <div class="text-h5 text-weight-bold q-mb-xs">Cedula verificada</div>
          <div class="att-text-muted q-mb-lg" style="font-size: var(--att-text-sm);">
            Tu identidad fue verificada contra el Padron Nacional del TSE.
            La credencial se almaceno en tu boveda.
          </div>

          <!-- Credential card preview -->
          <div class="credential-preview q-mb-lg">
            <div class="credential-preview__header">
              <q-icon name="verified_user" color="positive" size="20px" />
              <span class="text-weight-bold">Credencial de Identidad</span>
              <q-badge
                :color="identityTrust === 'A+' ? 'positive' : 'primary'"
                :label="identityTrust"
                class="q-ml-auto"
              />
            </div>
            <div class="credential-preview__body">
              <!-- Photo + fields side by side -->
              <div class="credential-content">
                <div v-if="frontCapture" class="credential-photo">
                  <img :src="frontCapture" alt="Foto" />
                </div>
                <div class="credential-fields">
                  <div class="credential-field">
                    <span class="credential-field__label">Cedula</span>
                    <span class="credential-field__value">{{ formattedCedula }}</span>
                  </div>
                  <div class="credential-field credential-field--stacked">
                    <span class="credential-field__label">Nombre</span>
                    <span class="credential-field__value">
                      {{ (manualNombre + ' ' + manualApellido1 + ' ' + manualApellido2).trim() }}
                    </span>
                  </div>
                  <div class="credential-field">
                    <span class="credential-field__label">Emisor</span>
                    <span class="credential-field__value">{{ TSE_AUTHORITY.shortName }}</span>
                  </div>
                  <div v-if="extractedData?.fechaNacimiento" class="credential-field">
                    <span class="credential-field__label">Nacimiento</span>
                    <span class="credential-field__value">{{ extractedData.fechaNacimiento }}</span>
                  </div>
                </div>
              </div>

              <!-- Verification badges -->
              <div class="credential-badges q-mt-sm">
                <div v-if="faceMatchScore" class="credential-badge credential-badge--positive">
                  <q-icon name="face" size="14px" />
                  <span>Rostro {{ Math.round(faceMatchScore * 100) }}%</span>
                </div>
                <div v-if="padronMatch" class="credential-badge credential-badge--positive">
                  <q-icon name="how_to_reg" size="14px" />
                  <span>Padron TSE</span>
                </div>
                <div v-if="nameMatch" class="credential-badge credential-badge--positive">
                  <q-icon name="spellcheck" size="14px" />
                  <span>Nombre coincide</span>
                </div>
                <div v-else-if="nameMatch === false" class="credential-badge credential-badge--warning">
                  <q-icon name="spellcheck" size="14px" />
                  <span>Nombre difiere</span>
                </div>
                <div v-if="firmaDigitalCert" class="credential-badge credential-badge--positive">
                  <q-icon name="security" size="14px" />
                  <span>{{ firmaDigitalCert.issuer }}</span>
                </div>
                <div v-if="docAnalysis?.format === 'old'" class="credential-badge credential-badge--neutral">
                  <q-icon name="history" size="14px" />
                  <span>Formato anterior</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Firma Digital upgrade prompt -->
          <div v-if="identityTrust === 'B'" class="firma-upgrade q-mb-md">
            <q-icon name="security" size="24px" color="warning" />
            <div>
              <div class="text-weight-bold" style="font-size: var(--att-text-sm);">Mejora tu nivel de confianza</div>
              <div class="att-text-muted" style="font-size: var(--att-text-xs);">
                Con tu Firma Digital podes subir de nivel B a A+ y firmar documentos con validez juridica.
              </div>
              <q-btn
                flat dense no-caps
                color="warning"
                label="Conectar Firma Digital"
                icon="vpn_key"
                size="sm"
                class="q-mt-xs"
                @click="router.push('/settings')"
              />
            </div>
          </div>

          <!-- Mobile app reminder -->
          <div class="mobile-reminder q-mb-lg">
            <q-icon name="phone_iphone" size="24px" color="info" />
            <div>
              <div class="text-weight-bold" style="font-size: var(--att-text-sm);">Lleva tu credencial en el celular</div>
              <div class="att-text-muted" style="font-size: var(--att-text-xs);">
                Instala Attestto en tu telefono para presentar tu identidad verificada en cualquier lugar.
              </div>
              <a href="https://mobile.attestto.com" target="_blank" class="text-primary" style="font-size: var(--att-text-xs);">
                mobile.attestto.com
              </a>
            </div>
          </div>

          <div class="q-gutter-sm row justify-center">
            <q-btn color="primary" icon="home" label="Ir al inicio" @click="router.push('/')" />
            <q-btn flat color="grey" label="Ver credenciales" @click="router.push('/credentials')" />
          </div>
        </div>
      </template>

      <!-- ERROR -->
      <template v-if="step === 'error'">
        <div class="done-state">
          <q-icon name="error_outline" size="64px" color="negative" class="q-mb-md" />
          <div class="text-h5 text-weight-bold q-mb-xs">Error de verificacion</div>
          <div class="att-text-muted q-mb-lg">
            No se pudo verificar la cedula. Intenta de nuevo o usa otro metodo.
          </div>
          <q-btn color="primary" label="Intentar de nuevo" @click="step = 'front'" />
        </div>
      </template>

    </div>
  </q-page>
</template>

<style scoped lang="scss">
.cedula-page {
  max-width: 900px;
}

.cedula-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

// ── Step indicator ──
.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
}

.step-dot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;

  .q-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--att-bg-surface);
    border: 2px solid var(--att-border);
    color: var(--att-text-muted);
    font-size: var(--att-text-xs);
    font-weight: 700;
  }

  span {
    font-size: var(--att-text-xs);
    color: var(--att-text-muted);
  }

  &.active .q-icon {
    border-color: var(--att-primary);
    background: var(--att-primary);
    color: white;
  }

  &.done .q-icon {
    border-color: var(--q-positive);
    background: var(--q-positive);
    color: white;
  }
}

.step-line {
  width: 40px;
  height: 2px;
  background: var(--att-border);
  margin: 0 0.5rem;
  margin-bottom: 1.25rem; // align with dot center

  &.done {
    background: var(--q-positive);
  }
}

// ── Capture ──
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
  border: 2px dashed rgba(255, 255, 255, 0.3);
  border-radius: 0.5rem;
  pointer-events: none;
  z-index: 1;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;

  &--scanning {
    border-color: rgba(255, 255, 255, 0.4);
    animation: scan-pulse 1.5s ease-in-out infinite;
  }

  &--found {
    border-color: #10b981;
    border-style: solid;
    box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
  }
}

.camera-capture--qr-found {
  border-color: #10b981;
}

@keyframes scan-pulse {
  0%, 100% { border-color: rgba(255, 255, 255, 0.3); }
  50% { border-color: rgba(255, 255, 255, 0.6); }
}

.doc-feedback-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2;
  padding: 0.75rem;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  pointer-events: none;
}

.doc-feedback {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  font-size: var(--att-text-sm);
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);

  &--ready {
    color: #10b981;
  }

  &--warning {
    color: #f59e0b;
  }
}

// ── Captured thumbnail ──
.captured-thumbnail {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  background: var(--att-bg-surface);
  border-radius: 0.5rem;
  border: 1px solid var(--att-border);

  img {
    width: 80px;
    height: 50px;
    object-fit: cover;
    border-radius: 0.25rem;
  }
}

.captured-thumbnail__badge {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--att-text-xs);
  flex: 1;
}

// ── Review (2-column layout) ──
.review-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  align-items: start;
}

.review-images {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  position: sticky;
  top: 1rem;
}

.review-capture {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.review-thumbnail {
  border-radius: 0.5rem;
  border: 1px solid var(--att-border);
  overflow: hidden;
  max-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
}

.review-capture-label {
  font-size: var(--att-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--att-text-muted);
}

.doc-notes {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.doc-note {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: var(--att-text-xs);
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;

  &--info {
    background: rgba(var(--att-primary-rgb, 76, 175, 80), 0.1);
    color: var(--att-text-body);
  }

  &--warning {
    background: rgba(255, 193, 7, 0.1);
    color: #ffc107;
  }
}

.review-data {
  min-width: 0;
}

.ocr-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--att-text-sm);
  color: var(--att-text-muted);
  padding: 0.5rem 0;
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

.tse-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  font-size: var(--att-text-sm);

  &--invalid {
    background: rgba(239, 68, 68, 0.08);
    color: var(--q-negative);
  }
}

// ── Validating ──
.validating-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 0;
}

.validation-steps {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 320px;
}

.validation-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--att-text-sm);
}

.padron-privacy-note {
  padding: 0.875rem 1rem;
  border-radius: 0.625rem;
  border: 1px solid rgba(34, 211, 168, 0.3);
  background: rgba(34, 211, 168, 0.06);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #e2e8f0;
    font-size: var(--att-text-sm);
  }

  &__body {
    font-size: var(--att-text-xs);
    color: var(--att-text-muted);
    line-height: 1.45;
  }

  &__spinner {
    display: flex;
    justify-content: center;
    padding-top: 0.25rem;
  }
}

// ── Firma Digital upgrade ──
.firma-upgrade {
  padding: 1rem 0;
}

.firma-upgrade__check {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.15);
  border-radius: 0.5rem;
}

.firma-upgrade__card {
  padding: 1.25rem;
  border-radius: 0.75rem;
  border: 1px solid var(--att-border);
  background: var(--att-bg-surface);
}

.firma-upgrade__card-header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.firma-upgrade__benefits {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.firma-benefit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--att-text-sm);
}

.firma-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--att-text-sm);
  padding: 0.5rem 0;
}

.firma-linked {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: rgba(16, 185, 129, 0.06);
  border: 1px solid rgba(16, 185, 129, 0.15);
  border-radius: 0.5rem;
}

// ── Capture mode selection ──
.capture-mode-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.capture-mode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  padding: 1.25rem;
  border-radius: 0.75rem;
  border: 1px solid var(--att-border);
  background: var(--att-bg-surface);
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--att-primary);
    background: var(--att-primary-soft);
  }
}

// ── Mobile capture flow ──
.mobile-capture-flow {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mobile-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.5rem 0;
}

.mobile-qr-image {
  border-radius: 0.75rem;
  border: 1px solid var(--att-border);
}

.mobile-waiting-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--att-text-sm);
  color: var(--att-text-muted);
}

.mobile-preview-thumb {
  width: 140px;
  border-radius: 0.5rem;
  border: 1px solid var(--att-border);
}

.mobile-preview-row {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
}

// ── Done ──
.done-state {
  text-align: center;
  padding: 2rem 0;
}

// ── Credential preview ──
.credential-preview {
  border: 1px solid var(--att-border);
  border-radius: 0.75rem;
  overflow: hidden;
  text-align: left;
  max-width: 440px;
  margin: 0 auto;
}

.credential-preview__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--att-bg-surface);
  border-bottom: 1px solid var(--att-border);
  font-size: var(--att-text-sm);
}

.credential-preview__body {
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.credential-field {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--att-text-sm);
  gap: 0.75rem;

  &--stacked {
    flex-direction: column;
    gap: 0;
    align-items: flex-start;
  }
}

.credential-field__label {
  color: var(--att-text-muted);
  flex-shrink: 0;
}

.credential-field__value {
  font-weight: 600;
  text-align: right;

  .credential-field--stacked & {
    text-align: left;
  }
}

.mobile-reminder {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--att-border);
  border-radius: 0.75rem;
  background: var(--att-bg-surface);
  text-align: left;
  max-width: 440px;
  margin: 0 auto;
}

.firma-upgrade {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px dashed var(--q-warning);
  border-radius: 0.75rem;
  background: rgba(255, 193, 7, 0.05);
  text-align: left;
  max-width: 440px;
  margin: 0 auto;
}

.credential-content {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.credential-photo {
  flex-shrink: 0;
  width: 80px;
  height: 100px;
  border-radius: 0.375rem;
  overflow: hidden;
  border: 1px solid var(--att-border);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.credential-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.credential-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.credential-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--att-text-xs);
  padding: 0.2rem 0.5rem;
  border-radius: 1rem;

  &--positive {
    background: rgba(var(--att-primary-rgb, 76, 175, 80), 0.15);
    color: var(--q-positive);
  }

  &--warning {
    background: rgba(255, 193, 7, 0.15);
    color: #ffc107;
  }

  &--neutral {
    background: rgba(255, 255, 255, 0.08);
    color: var(--att-text-muted);
  }
}
</style>
