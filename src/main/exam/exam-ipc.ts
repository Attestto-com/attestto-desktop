/**
 * Exam IPC handlers — bridges renderer requests to the exam session engine.
 *
 * Lockdown controls (kiosk, keyboard blocking) run here because
 * BrowserWindow APIs are main-process only.
 */
import { ipcMain, BrowserWindow } from 'electron'
import type {
  ExamStartParams,
  ExamAnswerParams,
  ExamProctorEventParams,
  ProctorEvent,
} from '../../shared/exam-api'
import {
  startExamSession,
  getQuestion,
  recordAnswer,
  recordProctorEvent,
  submitExam,
  getSessionStatus,
} from './exam-session'

let lockdownWindow: BrowserWindow | null = null
let keyBlockHandler: ((event: Electron.Event, input: Electron.Input) => void) | null = null

// ── Lockdown ─────────────────────────────────────────

function enterLockdown(win: BrowserWindow): void {
  lockdownWindow = win

  // Kiosk mode — fullscreen, no title bar, no Dock/taskbar access
  win.setKiosk(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setMinimizable(false)
  win.setClosable(false)
  win.setFullScreenable(false)

  // Block keyboard shortcuts that could escape
  keyBlockHandler = (event: Electron.Event, input: Electron.Input) => {
    const key = input.key.toLowerCase()

    // Allow basic text input keys, arrow keys, number keys
    const allowedKeys = [
      'a', 'b', 'c', 'd',  // answer selection
      'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
      'enter', 'backspace', 'space',
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
    ]

    // Block if modifier keys are pressed (except Shift for typing)
    if (input.meta || input.alt || input.control) {
      event.preventDefault()
      // Report blocked key attempt to session
      win.webContents.send('exam:lockdown-violation', {
        type: 'blocked-key',
        timestamp: new Date().toISOString(),
        data: { key: input.key, meta: input.meta, alt: input.alt, ctrl: input.control },
      } satisfies ProctorEvent)
      return
    }

    // Block escape, F-keys, Tab
    if (key === 'escape' || key === 'tab' || key.startsWith('f') && /^f\d+$/.test(key)) {
      event.preventDefault()
      win.webContents.send('exam:lockdown-violation', {
        type: 'blocked-key',
        timestamp: new Date().toISOString(),
        data: { key: input.key },
      } satisfies ProctorEvent)
      return
    }
  }

  win.webContents.on('before-input-event', keyBlockHandler)
}

function exitLockdown(): void {
  if (!lockdownWindow) return

  lockdownWindow.setKiosk(false)
  lockdownWindow.setAlwaysOnTop(false)
  lockdownWindow.setMinimizable(true)
  lockdownWindow.setClosable(true)
  lockdownWindow.setFullScreenable(true)

  if (keyBlockHandler) {
    lockdownWindow.webContents.removeListener('before-input-event', keyBlockHandler)
    keyBlockHandler = null
  }

  lockdownWindow = null
}

// ── IPC Registration ─────────────────────────────────

export function registerExamIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle('exam:enter-lockdown', async () => {
    enterLockdown(mainWindow)
  })

  ipcMain.handle('exam:exit-lockdown', async () => {
    exitLockdown()
  })

  ipcMain.handle('exam:start', async (_event, params: ExamStartParams) => {
    // Resolve subject DID from vault — fall back to placeholder if locked
    const contents = (await import('../vault/vault-service')).vaultService.read()
    const subjectDid = contents?.identity?.did ?? 'did:key:pending'
    return startExamSession(params, subjectDid)
  })

  ipcMain.handle('exam:get-question', async (_event, params: { sessionId: string; index: number }) => {
    return getQuestion(params.sessionId, params.index)
  })

  ipcMain.handle('exam:answer', async (_event, params: ExamAnswerParams) => {
    return recordAnswer(params)
  })

  ipcMain.handle('exam:report-event', async (_event, params: ExamProctorEventParams) => {
    const event: ProctorEvent = {
      type: params.type,
      timestamp: new Date().toISOString(),
      data: params.data,
    }
    recordProctorEvent(params.sessionId, event)
  })

  ipcMain.handle('exam:submit', async (_event, sessionId: string) => {
    exitLockdown()
    return submitExam(sessionId)
  })

  ipcMain.handle('exam:status', async (_event, sessionId: string) => {
    return getSessionStatus(sessionId)
  })
}

export function unregisterExamIPC(): void {
  exitLockdown()
  ipcMain.removeHandler('exam:enter-lockdown')
  ipcMain.removeHandler('exam:exit-lockdown')
  ipcMain.removeHandler('exam:start')
  ipcMain.removeHandler('exam:get-question')
  ipcMain.removeHandler('exam:answer')
  ipcMain.removeHandler('exam:report-event')
  ipcMain.removeHandler('exam:submit')
  ipcMain.removeHandler('exam:status')
}
