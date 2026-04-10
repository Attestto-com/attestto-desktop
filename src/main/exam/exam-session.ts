/**
 * Exam session engine — runs in the main process only.
 *
 * Owns the question bank, correct answers, hash chain, and scoring.
 * The renderer never sees correct answers or the raw chain — only
 * question text, option labels, and the final session proof hash.
 */
import { createHash, randomUUID } from 'node:crypto'
import type {
  ExamQuestionFull,
  ExamQuestion,
  ExamSession,
  ExamStartParams,
  ExamStartResult,
  ExamAnswerParams,
  ExamAnswerResult,
  ExamResult,
  ProctorEvent,
  ProctorFlag,
  FlagSeverity,
} from '../../shared/exam-api'

// ── Hash Chain ───────────────────────────────────────

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function chainAppend(currentHead: string, event: ProctorEvent): string {
  const payload = JSON.stringify({ prev: currentHead, event })
  return sha256(payload)
}

// ── Question Bank (in-memory for now) ────────────────

// TODO: load from encrypted signed JSON bundle per ATT-398.
// For now, the full COSEVI bank lives here in the main process.
const COSEVI_BANK: ExamQuestionFull[] = [
  {
    id: 1, category: 'ley-9078',
    text: '¿Cuál es la ley que rige actualmente el tránsito en Costa Rica?',
    options: [
      { value: 'a', label: 'Ley 7331' },
      { value: 'b', label: 'Ley 6324' },
      { value: 'c', label: 'Ley 9078' },
    ],
    correct: 'c',
  },
  {
    id: 2, category: 'señalización',
    text: '¿Cuál es la velocidad máxima permitida en una rotonda?',
    options: [
      { value: 'a', label: '20 km/h' },
      { value: 'b', label: '30 km/h' },
      { value: 'c', label: '40 km/h' },
    ],
    correct: 'b',
  },
  {
    id: 3, category: 'señalización',
    text: '¿Qué significa una línea amarilla continua en el centro de la vía?',
    options: [
      { value: 'a', label: 'Se puede adelantar con precaución' },
      { value: 'b', label: 'Prohibido adelantar' },
      { value: 'c', label: 'Carril exclusivo para buses' },
    ],
    correct: 'b',
  },
  {
    id: 4, category: 'mecánica',
    text: '¿Qué instrumento mide las revoluciones por minuto del motor?',
    options: [
      { value: 'a', label: 'Odómetro' },
      { value: 'b', label: 'Velocímetro' },
      { value: 'c', label: 'Tacómetro' },
    ],
    correct: 'c',
  },
  {
    id: 5, category: 'seguridad-vial',
    text: '¿Cuál es el efecto del alcohol en la conducción?',
    options: [
      { value: 'a', label: 'Aumenta la capacidad visual' },
      { value: 'b', label: 'Aumenta la maniobrabilidad' },
      { value: 'c', label: 'Aumenta el tiempo de reacción y genera falsa euforia' },
    ],
    correct: 'c',
  },
  {
    id: 6, category: 'seguridad-vial',
    text: '¿Dónde debe colocarse el cinturón de seguridad una mujer embarazada?',
    options: [
      { value: 'a', label: 'Sobre el pecho, debajo del vientre' },
      { value: 'b', label: 'Debajo del pecho, sobre el vientre' },
      { value: 'c', label: 'Debajo del pecho, debajo del vientre' },
    ],
    correct: 'a',
  },
  {
    id: 7, category: 'seguridad-vial',
    text: '¿Cuál es la causa principal de colisión frontal?',
    options: [
      { value: 'a', label: 'Distancia de seguimiento inadecuada' },
      { value: 'b', label: 'Invasión del carril izquierdo' },
      { value: 'c', label: 'Velocidad en giro a la derecha' },
    ],
    correct: 'b',
  },
  {
    id: 8, category: 'seguridad-vial',
    text: '¿Qué factores afectan el tiempo de reacción del conductor?',
    options: [
      { value: 'a', label: 'Condiciones de la vía' },
      { value: 'b', label: 'Estado físico y mental del conductor' },
      { value: 'c', label: 'Velocidad del vehículo' },
    ],
    correct: 'b',
  },
  {
    id: 9, category: 'peatones',
    text: '¿Qué debe portar un peatón de noche cerca de la vía?',
    options: [
      { value: 'a', label: 'Caminar por el lado derecho' },
      { value: 'b', label: 'Linterna o material reflectivo' },
      { value: 'c', label: 'Permanecer cerca de la calzada' },
    ],
    correct: 'b',
  },
  {
    id: 10, category: 'señalización',
    text: '¿Qué tipo de curvas existen?',
    options: [
      { value: 'a', label: 'Cerradas y abiertas' },
      { value: 'b', label: 'Suaves y pronunciadas' },
      { value: 'c', label: 'Horizontales y verticales' },
    ],
    correct: 'c',
  },
]

// ── Active Sessions ──────────────────────────────────

const activeSessions = new Map<string, {
  session: ExamSession
  /** Selected questions for this exam (full, with answers). */
  questions: ExamQuestionFull[]
  /** Which questions have been answered, and what the user picked. */
  answers: Map<number, string>
  /** Raw event chain for audit. */
  events: ProctorEvent[]
}>()

// ── Fisher-Yates shuffle ─────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Public API ───────────────────────────────────────

export function startExamSession(params: ExamStartParams, subjectDid: string): ExamStartResult {
  const sessionId = randomUUID()
  const count = Math.min(params.questionCount, COSEVI_BANK.length)
  const selected = shuffle(COSEVI_BANK).slice(0, count)

  const now = new Date().toISOString()
  const startEvent: ProctorEvent = { type: 'session-start', timestamp: now }
  const chainHead = chainAppend('0'.repeat(64), startEvent)

  const session: ExamSession = {
    sessionId,
    subjectDid,
    bankId: params.bankId,
    questionCount: count,
    startedAt: now,
    endedAt: null,
    chainHead,
    eventCount: 1,
    flags: [],
    score: null,
    answered: 0,
    passThreshold: params.passThreshold,
    passed: null,
    needsReview: false,
  }

  activeSessions.set(sessionId, {
    session,
    questions: selected,
    answers: new Map(),
    events: [startEvent],
  })

  return {
    sessionId,
    totalQuestions: count,
    timeLimitSec: params.timeLimitSec,
    passThreshold: params.passThreshold,
  }
}

/** Get a question by index — strips the correct answer before returning. */
export function getQuestion(sessionId: string, index: number): ExamQuestion | null {
  const entry = activeSessions.get(sessionId)
  if (!entry) return null
  const q = entry.questions[index]
  if (!q) return null
  // Strip correct answer — renderer must never see it
  return { id: q.id, text: q.text, options: q.options, category: q.category }
}

/** Record an answer. Returns progress but not correctness. */
export function recordAnswer(params: ExamAnswerParams): ExamAnswerResult {
  const entry = activeSessions.get(params.sessionId)
  if (!entry) return { recorded: false, answeredCount: 0, totalQuestions: 0 }

  const { session, answers } = entry
  answers.set(params.questionId, params.selectedValue)

  const event: ProctorEvent = {
    type: 'answer',
    timestamp: new Date().toISOString(),
    data: { questionId: params.questionId },
  }
  session.chainHead = chainAppend(session.chainHead, event)
  session.eventCount++
  entry.events.push(event)
  session.answered = answers.size

  return {
    recorded: true,
    answeredCount: answers.size,
    totalQuestions: session.questionCount,
  }
}

/** Record a proctor event (focus loss, blocked key, etc.). */
export function recordProctorEvent(sessionId: string, event: ProctorEvent): void {
  const entry = activeSessions.get(sessionId)
  if (!entry) return

  const { session } = entry
  session.chainHead = chainAppend(session.chainHead, event)
  session.eventCount++
  entry.events.push(event)

  // Auto-flag certain events
  const flagMap: Record<string, { severity: FlagSeverity; description: string } | undefined> = {
    'focus-lost': { severity: 'warning', description: 'El usuario salió de la ventana del examen' },
    'blocked-key': { severity: 'info', description: 'Intento de atajo de teclado bloqueado' },
    'face-absent': { severity: 'warning', description: 'No se detectó rostro frente a la cámara' },
    'face-multiple': { severity: 'critical', description: 'Múltiples rostros detectados' },
  }

  const flagDef = flagMap[event.type]
  if (flagDef) {
    session.flags.push({
      type: event.type,
      severity: flagDef.severity,
      timestamp: event.timestamp,
      description: flagDef.description,
    })
    if (flagDef.severity === 'critical') {
      session.needsReview = true
    }
  }
}

/** Finalize the exam — compute score, close session. */
export function submitExam(sessionId: string): ExamResult | null {
  const entry = activeSessions.get(sessionId)
  if (!entry) return null

  const { session, questions, answers } = entry
  const now = new Date().toISOString()

  // Score
  let correct = 0
  for (const q of questions) {
    if (answers.get(q.id) === q.correct) correct++
  }

  const percentage = questions.length > 0 ? correct / questions.length : 0
  const passed = percentage >= session.passThreshold

  // Close session
  session.score = correct
  session.passed = passed
  session.endedAt = now

  // Check if too many warnings warrant review
  const warningCount = session.flags.filter(f => f.severity === 'warning').length
  if (warningCount >= 3) session.needsReview = true

  // Final chain event
  const endEvent: ProctorEvent = {
    type: 'session-end',
    timestamp: now,
    data: { score: correct, total: questions.length, passed },
  }
  session.chainHead = chainAppend(session.chainHead, endEvent)
  session.eventCount++
  entry.events.push(endEvent)

  const startTime = new Date(session.startedAt).getTime()
  const endTime = new Date(now).getTime()

  return {
    sessionId,
    score: correct,
    totalQuestions: questions.length,
    percentage: Math.round(percentage * 100),
    passed,
    flags: session.flags,
    needsReview: session.needsReview,
    sessionProof: session.chainHead,
    startedAt: session.startedAt,
    endedAt: now,
    durationSec: Math.round((endTime - startTime) / 1000),
  }
}

/** Get session status (for timer sync, reconnection). */
export function getSessionStatus(sessionId: string): ExamSession | null {
  return activeSessions.get(sessionId)?.session ?? null
}
