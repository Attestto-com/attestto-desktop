/**
 * useProctor — orchestrates a proctored exam session from the renderer.
 *
 * Coordinates:
 *   - Exam session lifecycle (start → questions → answers → submit)
 *   - Lockdown mode (kiosk + keyboard blocking)
 *   - Camera feed (via useCamera)
 *   - Timer countdown
 *
 * All scoring and hash-chain logic lives in the main process.
 * This composable only drives the UI.
 */
import { ref, computed, onUnmounted } from 'vue'
import { useCamera } from './useCamera'
import { useLockdown } from './useLockdown'
import type {
  ExamQuestion,
  ExamStartParams,
  ExamStartResult,
  ExamResult,
  ProctorFlag,
} from '../../shared/exam-api'

export type ExamPhase = 'ready' | 'in-progress' | 'submitting' | 'result'

export function useProctor() {
  const camera = useCamera()
  const lockdown = useLockdown()

  const phase = ref<ExamPhase>('ready')
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

  let timerInterval: ReturnType<typeof setInterval> | null = null

  const api = (window as unknown as {
    presenciaAPI?: {
      exam?: {
        start: (params: ExamStartParams) => Promise<ExamStartResult>
        getQuestion: (sessionId: string, index: number) => Promise<ExamQuestion | null>
        answer: (params: { sessionId: string; questionId: number; selectedValue: string }) => Promise<{ recorded: boolean; answeredCount: number; totalQuestions: number }>
        submit: (sessionId: string) => Promise<ExamResult>
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
      // Start camera
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

      // Activate lockdown (kiosk mode)
      await lockdown.activate(res.sessionId)

      // Load first question
      await loadQuestion(0)

      // Start countdown
      startTimer()

      phase.value = 'in-progress'
    } catch (err) {
      error.value = `Error al iniciar examen: ${err}`
      // Clean up on failure
      await lockdown.deactivate()
    }
  }

  async function submitExam(): Promise<void> {
    if (!api || !sessionId.value) return

    phase.value = 'submitting'
    stopTimer()

    try {
      const res = await api.submit(sessionId.value)
      result.value = res
      phase.value = 'result'
    } catch (err) {
      error.value = `Error al enviar examen: ${err}`
      phase.value = 'in-progress'
    } finally {
      // Exit lockdown and stop camera after showing result
      await lockdown.deactivate()
      setTimeout(() => camera.stop(), 2000)
    }
  }

  function reset(): void {
    phase.value = 'ready'
    sessionId.value = null
    currentIndex.value = 0
    currentQuestion.value = null
    totalQuestions.value = 0
    answeredCount.value = 0
    timeRemaining.value = 0
    result.value = null
    error.value = null
    answeredMap.value = {}
    stopTimer()
  }

  onUnmounted(() => {
    stopTimer()
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
    lockdown,
    camera,

    // Actions
    startExam,
    submitExam,
    selectAnswer,
    nextQuestion,
    prevQuestion,
    goToQuestion,
    reset,
  }
}
