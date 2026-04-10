/**
 * Shared types for the proctored exam system (ATT-398).
 *
 * The exam engine runs in the main process to keep question answers,
 * session hashes, and lockdown controls out of renderer reach.
 * The renderer drives UI only — it never sees correct answers.
 */

// ── Question Bank ────────────────────────────────────

/** A single multiple-choice question delivered to the renderer. No correct answer included. */
export interface ExamQuestion {
  id: number
  text: string
  options: { value: string; label: string }[]
  /** Optional category tag for mastery tracking (e.g. "señalización", "ley-9078"). */
  category?: string
}

/** Full question with correct answer — lives only in main process. */
export interface ExamQuestionFull extends ExamQuestion {
  correct: string
}

/** Encrypted question bank bundle metadata. */
export interface QuestionBankMeta {
  bankId: string
  version: string
  totalQuestions: number
  categories: string[]
}

// ── Session & Events ─────────────────────────────────

/** Types of proctor events recorded in the session hash chain. */
export type ProctorEventType =
  | 'session-start'
  | 'session-end'
  | 'answer'
  | 'focus-lost'
  | 'focus-regained'
  | 'blocked-key'
  | 'face-absent'
  | 'face-present'
  | 'face-multiple'
  | 'frame-captured'
  | 'question-delivered'

/** A single proctor event appended to the hash chain. */
export interface ProctorEvent {
  type: ProctorEventType
  timestamp: string
  /** Event-specific payload. */
  data?: Record<string, unknown>
}

/** Flag severity for review queue. */
export type FlagSeverity = 'info' | 'warning' | 'critical'

/** A flagged incident during the exam. */
export interface ProctorFlag {
  type: ProctorEventType
  severity: FlagSeverity
  timestamp: string
  /** Duration in ms (for sustained flags like face-absent). */
  durationMs?: number
  description: string
}

/** Running exam session state (main process owns this). */
export interface ExamSession {
  sessionId: string
  /** DID of the exam taker. */
  subjectDid: string
  /** Which question bank is being used. */
  bankId: string
  /** Number of questions selected for this exam. */
  questionCount: number
  /** Timestamp when the exam started. */
  startedAt: string
  /** Timestamp when the exam ended (null while in progress). */
  endedAt: string | null
  /** Current hash chain head — SHA-256 hex of all events so far. */
  chainHead: string
  /** Total events appended to the chain. */
  eventCount: number
  /** Accumulated flags. */
  flags: ProctorFlag[]
  /** Final score (null while in progress). */
  score: number | null
  /** Total questions answered. */
  answered: number
  /** Pass threshold (0-1, e.g. 0.8 = 80%). */
  passThreshold: number
  /** Whether the session passed. */
  passed: boolean | null
  /** Whether the session needs human review due to flags. */
  needsReview: boolean
}

// ── IPC Contracts ────────────────────────────────────

/** Params to start an exam session. */
export interface ExamStartParams {
  /** Which question bank to use. */
  bankId: string
  /** Number of questions to draw (subset of bank). */
  questionCount: number
  /** Time limit in seconds. */
  timeLimitSec: number
  /** Pass threshold (0-1). */
  passThreshold: number
}

/** Result of starting an exam — renderer gets session metadata but no answers. */
export interface ExamStartResult {
  sessionId: string
  totalQuestions: number
  timeLimitSec: number
  passThreshold: number
}

/** Params to submit an answer. */
export interface ExamAnswerParams {
  sessionId: string
  questionId: number
  selectedValue: string
}

/** Result of submitting an answer — no correct/incorrect leak until exam ends. */
export interface ExamAnswerResult {
  recorded: boolean
  answeredCount: number
  totalQuestions: number
}

/** Params to report a proctor event from renderer (focus loss, etc.). */
export interface ExamProctorEventParams {
  sessionId: string
  type: ProctorEventType
  data?: Record<string, unknown>
}

/** Final exam result returned after submission. */
export interface ExamResult {
  sessionId: string
  score: number
  totalQuestions: number
  percentage: number
  passed: boolean
  flags: ProctorFlag[]
  needsReview: boolean
  /** SHA-256 hex of the complete event chain — the session proof. */
  sessionProof: string
  startedAt: string
  endedAt: string
  durationSec: number
}

/** Preload API shape for the exam namespace. */
export interface ExamApi {
  /** Enter kiosk lockdown mode. */
  enterLockdown: () => Promise<void>
  /** Exit kiosk lockdown mode. */
  exitLockdown: () => Promise<void>
  /** Start an exam session. Returns session metadata + first question. */
  start: (params: ExamStartParams) => Promise<ExamStartResult>
  /** Get the next question (or null if no more). No correct answer included. */
  getQuestion: (sessionId: string, index: number) => Promise<ExamQuestion | null>
  /** Submit an answer for the current question. */
  answer: (params: ExamAnswerParams) => Promise<ExamAnswerResult>
  /** Report a proctor event (focus loss, blocked key, etc.). */
  reportEvent: (params: ExamProctorEventParams) => Promise<void>
  /** End the exam and get the final result. */
  submit: (sessionId: string) => Promise<ExamResult>
  /** Get current session status (for reconnection / timer sync). */
  status: (sessionId: string) => Promise<ExamSession | null>

  /** Listen for lockdown violation events pushed from main process. */
  onLockdownViolation: (cb: (event: ProctorEvent) => void) => () => void
}
