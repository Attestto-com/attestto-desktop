/**
 * useFaceDetection — face detection using MediaPipe Face Detector.
 *
 * Lightweight detection: face present / absent / multiple faces.
 * No landmarks, no blendshapes — just bounding boxes and confidence.
 * Runs locally in the renderer process. No frames leave the device.
 *
 * Pliego 1.2.3.1.B: face absence detection, multiple face blocking,
 * periodic photo capture with hash for audit trail.
 *
 * Reference: https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector
 */
import { ref, onUnmounted } from 'vue'
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

export type FaceStatus = 'initializing' | 'present' | 'absent' | 'multiple' | 'error'

export function useFaceDetection() {
  const status = ref<FaceStatus>('initializing')
  const faceCount = ref(0)
  const error = ref<string | null>(null)
  const isRunning = ref(false)
  const lastFrameHash = ref<string | null>(null)

  let detector: FaceDetector | null = null
  let animationFrameId: number | null = null
  let videoElement: HTMLVideoElement | null = null
  let onFaceEvent: ((type: string, data?: Record<string, unknown>) => void) | null = null

  // Throttle detection to ~4 fps (250ms) to save CPU
  let lastDetectionTime = 0
  const DETECTION_INTERVAL_MS = 250

  // Frame capture interval (15s per pliego)
  let lastFrameCaptureTime = 0
  const FRAME_CAPTURE_INTERVAL_MS = 15_000

  // Absence tracking
  let absenceStart: number | null = null
  let wasAbsent = false
  const ABSENCE_THRESHOLD_MS = 5_000

  async function initialize(): Promise<void> {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      )

      detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      })

      status.value = 'absent'
    } catch (err) {
      error.value = `Error al inicializar detección facial: ${err}`
      status.value = 'error'
    }
  }

  function setEventCallback(cb: (type: string, data?: Record<string, unknown>) => void): void {
    onFaceEvent = cb
  }

  // ── Frame hash for audit trail ─────────────────

  async function hashFrame(canvas: HTMLCanvasElement): Promise<string> {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.5)
    )
    if (!blob) return ''
    const buffer = await blob.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  async function captureFrameHash(): Promise<void> {
    if (!videoElement || videoElement.readyState < 2) return
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth
    canvas.height = videoElement.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(videoElement, 0, 0)
    const hash = await hashFrame(canvas)
    lastFrameHash.value = hash
    onFaceEvent?.('frame-captured', { frameHash: hash })
  }

  // ── Detection loop ─────────────────────────────

  function detectLoop(timestamp: number): void {
    if (!isRunning.value || !detector || !videoElement) return

    if (timestamp - lastDetectionTime >= DETECTION_INTERVAL_MS) {
      lastDetectionTime = timestamp

      try {
        const result = detector.detectForVideo(videoElement, timestamp)
        const count = result.detections.length
        faceCount.value = count

        if (count === 0) {
          status.value = 'absent'

          if (!absenceStart) {
            absenceStart = timestamp
          }

          // Fire event after sustained absence
          if (!wasAbsent && absenceStart && timestamp - absenceStart >= ABSENCE_THRESHOLD_MS) {
            wasAbsent = true
            onFaceEvent?.('face-absent', { durationMs: timestamp - absenceStart })
          }
        } else if (count === 1) {
          status.value = 'present'

          if (wasAbsent && absenceStart) {
            onFaceEvent?.('face-present', { absentMs: timestamp - absenceStart })
          }

          absenceStart = null
          wasAbsent = false
        } else {
          status.value = 'multiple'
          absenceStart = null
          wasAbsent = false
          onFaceEvent?.('face-multiple', { count })
        }

        // Periodic frame capture with hash
        if (timestamp - lastFrameCaptureTime >= FRAME_CAPTURE_INTERVAL_MS) {
          lastFrameCaptureTime = timestamp
          captureFrameHash()
        }
      } catch {
        // Detection can fail on video resize — skip frame
      }
    }

    animationFrameId = requestAnimationFrame(detectLoop)
  }

  // ── Public API ─────────────────────────────────

  async function start(video: HTMLVideoElement): Promise<void> {
    videoElement = video

    if (!detector) {
      await initialize()
    }
    if (!detector) return

    isRunning.value = true
    absenceStart = null
    wasAbsent = false
    lastDetectionTime = 0
    lastFrameCaptureTime = 0
    animationFrameId = requestAnimationFrame(detectLoop)
  }

  function stop(): void {
    isRunning.value = false
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
    videoElement = null
    absenceStart = null
    wasAbsent = false
  }

  onUnmounted(() => {
    stop()
    detector?.close()
    detector = null
  })

  return {
    status,
    faceCount,
    error,
    isRunning,
    lastFrameHash,
    start,
    stop,
    setEventCallback,
    initialize,
  }
}
