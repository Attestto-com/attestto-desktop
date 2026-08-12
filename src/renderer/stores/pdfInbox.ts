import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Transient hand-off for a PDF opened from *outside* the viewer (e.g. dropped
 * on the unlock screen). The source view stashes the decoded bytes here and
 * navigates to `/pdf`; PdfPage consumes them once on mount and clears the slot.
 *
 * Kept deliberately tiny and non-persistent — this is a one-shot courier, not
 * document state. Bytes never touch disk or IPC.
 */
export const usePdfInboxStore = defineStore('pdfInbox', () => {
  const pendingBytes = ref<Uint8Array | null>(null)
  const pendingName = ref<string | null>(null)

  function setPending(bytes: Uint8Array, name: string) {
    pendingBytes.value = bytes
    pendingName.value = name
  }

  /** Return the pending file (if any) and clear the slot. */
  function consume(): { bytes: Uint8Array; name: string } | null {
    if (!pendingBytes.value) return null
    const out = { bytes: pendingBytes.value, name: pendingName.value ?? 'documento.pdf' }
    pendingBytes.value = null
    pendingName.value = null
    return out
  }

  return { pendingBytes, pendingName, setPending, consume }
})
