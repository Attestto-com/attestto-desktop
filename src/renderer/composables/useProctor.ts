/**
 * useProctor — orchestrates a proctored exam session from the renderer.
 *
 * Coordinates:
 *   - Consent (Ley 8968) — must accept before exam
 *   - Exam session lifecycle (start → questions → answers → submit)
 *   - Lockdown mode (kiosk + keyboard blocking)
 *   - Camera feed (via useCamera)
 *   - Face detection (via useFaceDetection)
 *   - Timer countdown
 *
 * All scoring and hash-chain logic lives in the main process.
 * This composable only drives the UI.
 */
import { ref, computed, onUnmounted } from 'vue'
import { useCamera } from './useCamera'
import { useLockdown } from './useLockdown'
import { useFaceDetection } from './useFaceDetection'
import type {
  ExamQuestion,
  ExamStartParams,
  ExamStartResult,
  ExamResult,
  ProctorFlag,
} from '../../shared/exam-api'

export type ExamPhase = 'consent' | 'ready' | 'in-progress' | 'submitting' | 'result'

export function useProctor() {
  const camera = useCamera()
  const lockdown = useLockdown()
  const faceDetection = useFaceDetection()

  const phase = ref<ExamPhase>('consent')
  const sessionId = ref<string | null>(null)
  const currentIndex = ref(0)
  const currentQuestion = ref<ExamQuestion | null>(null)
  const totalQuestions = ref(0)
  const answeredCount = ref(0)
  const timeRemaining = ref(0)
  const timeLimitSec = ref(0)
  const result = ref<ExamResult | null>(null)
  const error = ref<string | null>(null)
  const answeredMap = ref<Record<number, string>>({})

  // Consent state (Ley 8968)
  const consentAccepted = ref(false)
  const consentTimestamp = ref<string | null>(null)

  let timerInterval: ReturnType<typeof setInterval> | null = null

  // Video element ref for face detection binding
  let activeVideoElement: HTMLVideoElement | null = null

  const api = (window as unknown as {
    presenciaAPI?: {
      exam?: {
        start: (params: ExamStartParams) => Promise<ExamStartResult>
        getQuestion: (sessionId: string, index: number) => Promise<ExamQuestion | null>
        answer: (params: { sessionId: string; questionId: number; selectedValue: string }) => Promise<{ recorded: boolean; answeredCount: number; totalQuestions: number }>
        submit: (sessionId: string) => Promise<ExamResult>
        reportEvent: (params: { sessionId: string; type: string; data?: Record<string, unknown> }) => Promise<void>
      }
    }
  }).presenciaAPI?.exam

  const progress = computed(() =>
    totalQuestions.value > 0 ? ((currentIndex.value + 1) / totalQuestions.value) * 100 : 0
  )

  const formattedTime = computed(() => {
    const mins = Math.floor(timeRemaining.value / 60)
    const secs = timeRemaining.value % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  })

  const cameraReady = computed(() => camera.isActive.value)

  // ── Consent ────────────────────────────────────────

  function acceptConsent(): void {
    consentAccepted.value = true
    consentTimestamp.value = new Date().toISOString()
    phase.value = 'ready'
    // Start camera for preview after consent
    camera.start()
  }

  // ── Timer ──────────────────────────────────────────

  function startTimer(): void {
    timerInterval = setInterval(() => {
      if (timeRemaining.value > 0) {
        timeRemaining.value--
      } else {
        submitExam()
      }
    }, 1000)
  }

  function stopTimer(): void {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
  }

  // ── Face Detection Binding ─────────────────────────

  function bindVideoForDetection(el: HTMLVideoElement | null): void {
    // Bind to camera composable
    camera.bindVideo(el)

    // Also track for face detection
    if (el && camera.isActive.value) {
      activeVideoElement = el
      // Start face detection if exam is in progress
      if (phase.value === 'in-progress' && !faceDetection.isRunning.value) {
        faceDetection.start(el)
      }
    }
  }

  // ── Question Navigation ────────────────────────────

  async function loadQuestion(index: number): Promise<void> {
    if (!api || !sessionId.value) return
    const q = await api.getQuestion(sessionId.value, index)
    currentQuestion.value = q
    currentIndex.value = index
  }

  async function goToQuestion(index: number): Promise<void> {
    if (index < 0 || index >= totalQuestions.value) return
    await loadQuestion(index)
  }

  async function nextQuestion(): Promise<void> {
    await goToQuestion(currentIndex.value + 1)
  }

  async function prevQuestion(): Promise<void> {
    await goToQuestion(currentIndex.value - 1)
  }

  // ── Answer Submission ──────────────────────────────

  async function selectAnswer(value: string): Promise<void> {
    if (!api || !sessionId.value || !currentQuestion.value) return

    answeredMap.value[currentIndex.value] = value

    const res = await api.answer({
      sessionId: sessionId.value,
      questionId: currentQuestion.value.id,
      selectedValue: value,
    })
    if (res.recorded) {
      answeredCount.value = res.answeredCount
    }
  }

  // ── Session Lifecycle ──────────────────────────────

  async function startExam(params?: Partial<ExamStartParams>): Promise<void> {
    if (!api) {
      error.value = 'API de examen no disponible'
      return
    }

    error.value = null

    try {
      // Start camera if not already active
      if (!camera.isActive.value) {
        await camera.start()
      }

      // Start exam session in main process
      const startParams: ExamStartParams = {
        bankId: params?.bankId ?? 'cosevi-ley-9078',
        questionCount: params?.questionCount ?? 10,
        timeLimitSec: params?.timeLimitSec ?? 40 * 60,
        passThreshold: params?.passThreshold ?? 0.8,
      }

      const res = await api.start(startParams)
      sessionId.value = res.sessionId
      totalQuestions.value = res.totalQuestions
      timeLimitSec.value = res.timeLimitSec
      timeRemaining.value = res.timeLimitSec

      // Wire face detection events to session hash chain
      faceDetection.setEventCallback((type, data) => {
        if (sessionId.value && api) {
          api.reportEvent({ sessionId: sessionId.value, type: type as any, data })
        }
      })

      // Start face detection on the active video element
      if (activeVideoElement) {
        await faceDetection.start(activeVideoElement)
      }

      // Activate lockdown (kiosk mode)
      await lockdown.activate(res.sessionId)

      // Load first question
      await loadQuestion(0)

      // Start countdown
      startTimer()

      phase.value = 'in-progress'
    } catch (err) {
      error.value = `Error al iniciar examen: ${err}`
      await lockdown.deactivate()
      faceDetection.stop()
    }
  }

  async function submitExam(): Promise<void> {
    if (!api || !sessionId.value) return

    phase.value = 'submitting'
    stopTimer()
    faceDetection.stop()

    try {
      const res = await api.submit(sessionId.value)
      result.value = res
      phase.value = 'result'
    } catch (err) {
      error.value = `Error al enviar examen: ${err}`
      phase.value = 'in-progress'
    } finally {
      await lockdown.deactivate()
      setTimeout(() => camera.stop(), 2000)
    }
  }

  function reset(): void {
    phase.value = 'consent'
    sessionId.value = null
    currentIndex.value = 0
    currentQuestion.value = null
    totalQuestions.value = 0
    answeredCount.value = 0
    timeRemaining.value = 0
    result.value = null
    error.value = null
    answeredMap.value = {}
    consentAccepted.value = false
    consentTimestamp.value = null
    stopTimer()
    faceDetection.stop()
  }

  onUnmounted(() => {
    stopTimer()
    faceDetection.stop()
    camera.stop()
    if (lockdown.state.value.active) {
      lockdown.deactivate()
    }
  })

  return {
    // State
    phase,
    sessionId,
    currentIndex,
    currentQuestion,
    totalQuestions,
    answeredCount,
    timeRemaining,
    formattedTime,
    progress,
    result,
    error,
    cameraReady,
    answeredMap,
    consentAccepted,
    consentTimestamp,

    // Sub-composables
    lockdown,
    camera,
    faceDetection,

    // Actions
    acceptConsent,
    startExam,
    submitExam,
    selectAnswer,
    nextQuestion,
    prevQuestion,
    goToQuestion,
    bindVideoForDetection,
    reset,
  }
}
