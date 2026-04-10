import { app } from 'electron'
import { join } from 'node:path'
import {
  MeshNode,
  MeshStore,
  MeshProtocol,
  MeshGC,
  DEFAULT_CONFIG,
  PUBLIC_BOOTSTRAP_PEERS,
} from '@attestto/mesh'
import type { MeshEvent, MeshNodeConfig } from '@attestto/mesh'

/**
 * MeshService — manages the full mesh lifecycle in the main process.
 *
 * Owns: MeshNode (network), MeshStore (storage), MeshProtocol (orchestration), MeshGC (cleanup).
 * Emits mesh events that get forwarded to the renderer via IPC.
 */
export class MeshService {
  private node: MeshNode | null = null
  private store: MeshStore | null = null
  private protocol: MeshProtocol | null = null
  private gc: MeshGC | null = null
  private eventListeners: Array<(event: MeshEvent) => void> = []

  private get dataDir(): string {
    return join(app.getPath('userData'), 'mesh-data')
  }

  get isRunning(): boolean {
    return this.node?.isRunning ?? false
  }

  async start(overrides?: Partial<MeshNodeConfig>): Promise<void> {
    if (this.isRunning) return

    const config: MeshNodeConfig = {
      ...DEFAULT_CONFIG,
      dataDir: this.dataDir,
      meshId: overrides?.meshId ?? detectMeshId(),
      // Desktop nodes are dial-out only (NAT'd, behind corporate firewalls).
      // Bind to an ephemeral OS-assigned port so two Attestto desktops on the
      // same LAN never collide on 4001, and so we don't need a firewall
      // exception in office environments. Reachability is provided by circuit
      // relay through anchor nodes (enableRelayClient).
      listenPort: 0,
      // Bind to all interfaces (IPv4 + IPv6) so the desktop can dial out over
      // LAN, public IPv4, and IPv6 simultaneously. The desktop is still a
      // dial-out client (no inbound listener exposed publicly) — binding to
      // 0.0.0.0 just means libp2p picks the right interface per peer.
      listenAddress: '0.0.0.0',
      enableRelayClient: true,
      enableRelayServer: false,
      // Public anchor bootstrap peers come from @attestto/mesh DEFAULT_CONFIG.
      // Override via MESH_BOOTSTRAP_PEERS env var (handled in main/index.ts).
      bootstrapPeers: [...PUBLIC_BOOTSTRAP_PEERS],
      ...overrides,
    }

    // Initialize components
    this.store = new MeshStore(config.dataDir, config.maxStorageBytes)
    this.node = new MeshNode(config)
    this.protocol = new MeshProtocol(this.node, this.store)
    this.gc = new MeshGC(this.store, this.node, config.minHoldersForEviction)

    // Forward mesh events to registered listeners
    this.node.on('mesh:event', (event: MeshEvent) => {
      for (const listener of this.eventListeners) {
        listener(event)
      }
    })

    // Start the node and GC
    await this.node.start()
    this.gc.start(config.gcIntervalMs)

    // Update storage metrics on the node
    const metrics = this.store.getUsage()
    this.node.updateStorageMetrics(metrics)
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return

    this.gc?.stop()
    await this.node?.stop()
    this.store?.close()

    this.gc = null
    this.protocol = null
    this.node = null
    this.store = null
  }

  getProtocol(): MeshProtocol {
    if (!this.protocol) throw new Error('Mesh not started')
    return this.protocol
  }

  getStore(): MeshStore {
    if (!this.store) throw new Error('Mesh not started')
    return this.store
  }

  getNode(): MeshNode {
    if (!this.node) throw new Error('Mesh not started')
    return this.node
  }

  /** Register an event listener. Returns unsubscribe function. */
  onEvent(listener: (event: MeshEvent) => void): () => void {
    this.eventListeners.push(listener)
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener)
    }
  }
}

/**
 * Auto-detect country mesh from system timezone.
 * Falls back to 'attestto-global' if unrecognized.
 */
function detectMeshId(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone // e.g. 'America/Costa_Rica'
  const tzCountryMap: Record<string, string> = {
    'America/Costa_Rica': 'attestto-cr',
    'America/Panama': 'attestto-pa',
    'America/Bogota': 'attestto-co',
    'America/Guatemala': 'attestto-gt',
    'America/El_Salvador': 'attestto-sv',
    'America/Tegucigalpa': 'attestto-hn',
    'America/Managua': 'attestto-ni',
    'America/Santo_Domingo': 'attestto-do',
    'America/Mexico_City': 'attestto-mx',
    'America/Lima': 'attestto-pe',
    'America/Santiago': 'attestto-cl',
    'America/Argentina/Buenos_Aires': 'attestto-ar',
    'America/Sao_Paulo': 'attestto-br',
    'Europe/Zurich': 'attestto-ch',
  }

  const meshId = tzCountryMap[tz] ?? 'attestto-global'
  console.log(`[mesh] Auto-detected meshId: ${meshId} (timezone: ${tz})`)
  return meshId
}

/** Singleton instance for the app */
export const meshService = new MeshService()
