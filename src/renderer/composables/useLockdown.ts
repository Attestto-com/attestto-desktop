/**
 * useLockdown — renderer-side lockdown monitoring.
 *
 * Kiosk mode and keyboard blocking are enforced by the main process
 * (exam-ipc.ts). This composable handles what the renderer can detect:
 *   - document visibility changes (tab/window focus loss)
 *   - lockdown violation events forwarded from main
 *
 * It reports all events to the exam session via IPC.
 */
import { ref, onMounted, onUnmounted } from 'vue'
import type { ProctorEvent, ProctorEventType } from '../../shared/exam-api'

interface LockdownState {
  active: boolean
  focusLost: boolean
  violations: ProctorEvent[]
  violationCount: number
}

export function useLockdown() {
  const state = ref<LockdownState>({
    active: false,
    focusLost: false,
    violations: [],
    violationCount: 0,
  })

  let sessionId: string | null = null
  let unsubViolation: (() => void) | null = null

  const api = (window as unknown as {
    presenciaAPI?: {
      exam?: {
        enterLockdown: () => Promise<void>
        exitLockdown: () => Promise<void>
        reportEvent: (params: { sessionId: string; type: ProctorEventType; data?: Record<string, unknown> }) => Promise<void>
        onLockdownViolation: (cb: (event: ProctorEvent) => void) => () => void
      }
    }
  }).presenciaAPI?.exam

  // ── Visibility change (focus loss detection) ───────

  function handleVisibilityChange(): void {
    if (!state.value.active || !sessionId || !api) return

    if (document.hidden) {
      state.value.focusLost = true
      api.reportEvent({ sessionId, type: 'focus-lost' })
    } else {
      state.value.focusLost = false
      api.reportEvent({ sessionId, type: 'focus-regained' })
    }
  }

  function handleWindowBlur(): void {
    if (!state.value.active || !sessionId || !api) return
    state.value.focusLost = true
    api.reportEvent({ sessionId, type: 'focus-lost', data: { source: 'blur' } })
  }

  function handleWindowFocus(): void {
    if (!state.value.active || !sessionId || !api) return
    state.value.focusLost = false
    api.reportEvent({ sessionId, type: 'focus-regained', data: { source: 'focus' } })
  }

  // ── Public API ─────────────────────────────────────

  async function activate(sid: string): Promise<void> {
    sessionId = sid
    if (api) {
      await api.enterLockdown()

      // Listen for main-process lockdown violations (blocked keys)
      unsubViolation = api.onLockdownViolation((event) => {
        state.value.violations.push(event)
        state.value.violationCount++
        // Forward to session hash chain
        if (sessionId) {
          api!.reportEvent({ sessionId, type: event.type, data: event.data })
        }
      })
    }

    // Renderer-side focus monitoring
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('focus', handleWindowFocus)

    state.value.active = true
  }

  async function deactivate(): Promise<void> {
    state.value.active = false
    sessionId = null

    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('blur', handleWindowBlur)
    window.removeEventListener('focus', handleWindowFocus)

    if (unsubViolation) {
      unsubViolation()
      unsubViolation = null
    }

    if (api) {
      await api.exitLockdown()
    }
  }

  onUnmounted(() => {
    if (state.value.active) {
      deactivate()
    }
  })

  return {
    state,
    activate,
    deactivate,
  }
}
