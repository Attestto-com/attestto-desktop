import { defineStore } from 'pinia'
import { ref, computed, onUnmounted } from 'vue'
import type {
  MeshStatusResult,
  MeshPutParams,
  MeshGetParams,
  MeshGetResult,
  MeshTombstoneParams,
  MeshEventPayload,
} from '../../shared/mesh-api'

export const useMeshStore = defineStore('mesh', () => {
  // ── State ──────────────────────────────────────────

  const status = ref<MeshStatusResult>({
    running: false,
    peerId: null,
    peerCount: 0,
    dhtReady: false,
    uptimeMs: 0,
    storage: { itemCount: 0, usedBytes: 0, limitBytes: 0, percentage: 0 },
    level: 'light',
  })

  const recentEvents = ref<MeshEventPayload[]>([])
  const error = ref<string | null>(null)
  const loading = ref(false)

  // ── Computed ───────────────────────────────────────

  const isRunning = computed(() => status.value.running)
  const peerCount = computed(() => status.value.peerCount)
  const storagePercent = computed(() => status.value.storage.percentage)

  // ── Actions ────────────────────────────────────────

  const api = window.presenciaAPI?.mesh

  async function refreshStatus(): Promise<void> {
    if (!api) return
    try {
      status.value = await api.status()
    } catch (err) {
      error.value = String(err)
    }
  }

  async function startMesh(): Promise<void> {
    if (!api) return
    loading.value = true
    error.value = null
    try {
      await api.start()
      await refreshStatus()
    } catch (err) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function stopMesh(): Promise<void> {
    if (!api) return
    loading.value = true
    try {
      await api.stop()
      await refreshStatus()
    } catch (err) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function put(params: MeshPutParams): Promise<string | null> {
    if (!api) return null
    try {
      const result = await api.put(params)
      await refreshStatus()
      return result.contentHash
    } catch (err) {
      error.value = String(err)
      return null
    }
  }

  async function get(params: MeshGetParams): Promise<MeshGetResult | null> {
    if (!api) return null
    try {
      return await api.get(params)
    } catch (err) {
      error.value = String(err)
      return null
    }
  }

  async function tombstone(params: MeshTombstoneParams): Promise<void> {
    if (!api) return
    try {
      await api.tombstone(params)
      await refreshStatus()
    } catch (err) {
      error.value = String(err)
    }
  }

  // ── Event Subscription ─────────────────────────────

  let unsubscribe: (() => void) | null = null

  function subscribe(): void {
    if (!api || unsubscribe) return
    unsubscribe = api.onEvent((event) => {
      const meshEvent = event as MeshEventPayload
      recentEvents.value = [meshEvent, ...recentEvents.value].slice(0, 50)

      // Auto-refresh status on significant events
      if (
        meshEvent.type === 'peer:connected' ||
        meshEvent.type === 'peer:disconnected' ||
        meshEvent.type === 'gc:completed' ||
        meshEvent.type === 'item:stored'
      ) {
        refreshStatus()
      }
    })
  }

  function unsubscribeEvents(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  // Auto-subscribe when the store is created in a component
  subscribe()

  return {
    // State
    status,
    recentEvents,
    error,
    loading,
    // Computed
    isRunning,
    peerCount,
    storagePercent,
    // Actions
    refreshStatus,
    startMesh,
    stopMesh,
    put,
    get,
    tombstone,
    subscribe,
    unsubscribeEvents,
  }
})
