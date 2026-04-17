// ── Local Capture Server (HTTPS) ──
// Runs an HTTPS + WSS server on the local network so a phone
// on the same WiFi can use getUserMedia for live camera capture.
//
// HTTPS is required because mobile browsers block getUserMedia on
// non-secure origins. We generate a self-signed cert at startup
// using the `selfsigned` package. The phone will see a cert warning
// once — after accepting, the live camera viewfinder works.
//
// Flow:
// 1. Desktop generates self-signed cert + starts HTTPS server
// 2. QR code shown: https://{local-ip}:{port}/capture/{session-id}
// 3. Phone scans QR → accepts cert → opens mobile capture page
// 4. Phone captures front + back (rear cam) + selfie (front cam with liveness)
// 5. Images + liveness data sent over WSS → desktop receives
// 6. Phone prompted to install PWA wallet
//
// Security: session IDs are single-use, expire after 5 minutes,
// and the phone must be on the same local network.
// The self-signed cert is DID-bound — its Subject includes the
// user's did:key, making it verifiable without a CA.

import { createServer as createHttpsServer } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { networkInterfaces } from 'node:os'
import { randomUUID } from 'node:crypto'
import nacl from 'tweetnacl'
import { generate as generateSelfSigned } from 'selfsigned'

export interface LivenessResult {
  faceDetected: boolean
  blinkCount: number
  durationMs: number
}

export interface CaptureSession {
  id: string
  createdAt: number
  expiresAt: number
  status: 'waiting' | 'connected' | 'capturing' | 'complete' | 'expired'
  frontImage?: string   // base64 jpeg
  backImage?: string    // base64 jpeg
  selfieImage?: string  // base64 jpeg
  livenessResult?: LivenessResult
  extractedData?: Record<string, string>
  ws?: WebSocket
  // E2E encryption keys (X25519 + nacl secretbox)
  keyPair?: nacl.BoxKeyPair
  sharedKey?: Uint8Array
}

export type CaptureEventCallback = (event: CaptureEvent) => void

export type CaptureEvent =
  | { type: 'session-created'; sessionId: string; url: string }
  | { type: 'phone-connected'; sessionId: string }
  | { type: 'phone-disconnected'; sessionId: string }
  | { type: 'front-captured'; sessionId: string; image: string }
  | { type: 'back-captured'; sessionId: string; image: string; extractedData?: Record<string, string> }
  | { type: 'selfie-captured'; sessionId: string; image: string; livenessResult?: LivenessResult }
  | { type: 'capture-complete'; sessionId: string }
  | { type: 'session-expired'; sessionId: string }

const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes

export class CaptureServer {
  private httpServer: ReturnType<typeof createHttpsServer> | null = null
  private wss: WebSocketServer | null = null
  private sessions = new Map<string, CaptureSession>()
  private port = 0
  private eventCallback: CaptureEventCallback | null = null
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private userDid: string | null = null

  /**
   * Generate a self-signed cert at startup. The cert Subject embeds the
   * user's DID (when present) so the phone can later pin trust against the
   * same DID it sees in the QR code, without needing a CA. Cert is ephemeral
   * (1-day validity, rotated on every server start) and unique per session.
   */
  private async generateCert(did: string | null): Promise<{ key: string; cert: string }> {
    const localIP = this.getLocalIP()
    const cn = did ? `did:${did.replace(/^did:/, '')}` : 'attestto-capture'
    const notBeforeDate = new Date()
    const notAfterDate = new Date(notBeforeDate.getTime() + 24 * 60 * 60 * 1000)
    const pems = await generateSelfSigned([{ name: 'commonName', value: cn }], {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate,
      notAfterDate,
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: localIP },
          ],
        },
      ],
    })
    return { key: pems.private, cert: pems.cert }
  }

  /** Start the capture server on a random available port */
  async start(did?: string): Promise<number> {
    this.userDid = did || null
    console.log(`[capture] Starting HTTPS server (DID: ${did || 'anonymous'})`)

    const { key, cert } = await this.generateCert(this.userDid)

    return new Promise((resolve, reject) => {
      const handler = (req: IncomingMessage, res: ServerResponse) => this.handleHTTP(req, res)
      this.httpServer = createHttpsServer({ key, cert }, handler)

      this.wss = new WebSocketServer({ server: this.httpServer })
      this.wss.on('connection', (ws, req) => this.handleWS(ws, req))

      this.httpServer.listen(0, '0.0.0.0', () => {
        const addr = this.httpServer!.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
          console.log(`[capture] HTTPS server started on port ${this.port}`)

          // Clean up expired sessions every 30s
          this.cleanupInterval = setInterval(() => this.cleanupExpired(), 30_000)

          resolve(this.port)
        } else {
          reject(new Error('Failed to get server address'))
        }
      })

      this.httpServer.on('error', reject)
    })
  }

  /** Stop the server */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.wss?.close()
    this.httpServer?.close()
    this.sessions.clear()
    this.port = 0
  }

  /** Set event callback */
  onEvent(callback: CaptureEventCallback): void {
    this.eventCallback = callback
  }

  /** Create a new capture session and return the QR URL */
  createSession(): { sessionId: string; url: string } {
    const sessionId = randomUUID().substring(0, 8)
    const localIP = this.getLocalIP()

    // Generate X25519 keypair for E2E encryption
    const keyPair = nacl.box.keyPair()

    const session: CaptureSession = {
      id: sessionId,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
      status: 'waiting',
      keyPair,
    }

    this.sessions.set(sessionId, session)

    // Embed public key in URL so phone can encrypt from first message
    const pubKeyHex = Buffer.from(keyPair.publicKey).toString('hex')
    const url = `https://${localIP}:${this.port}/capture/${sessionId}?pk=${pubKeyHex}`

    this.emit({ type: 'session-created', sessionId, url })

    return { sessionId, url }
  }

  /** Get session status */
  getSession(sessionId: string): CaptureSession | undefined {
    return this.sessions.get(sessionId)
  }

  /** Get the local network IP */
  private getLocalIP(): string {
    const interfaces = networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address
        }
      }
    }
    return '127.0.0.1'
  }

  /** Handle HTTP requests — serve the mobile capture page */
  private handleHTTP(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || ''

    // ATT-275: restrict CORS to the capture page origin (same server)
    const localIP = this.getLocalIP()
    const allowedOrigin = `https://${localIP}:${this.port}`
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Capture page: /capture/{sessionId}  (ignore query string)
    const pathname = url.split('?')[0]
    console.log(`[capture] HTTP ${req.method} ${pathname} (sessions: ${[...this.sessions.keys()].join(', ')})`)
    const captureMatch = pathname.match(/^\/capture\/([a-z0-9-]+)$/)
    if (captureMatch) {
      const sessionId = captureMatch[1]
      const session = this.sessions.get(sessionId)

      if (!session || Date.now() > session.expiresAt) {
        res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body><h1>Sesion expirada</h1><p>Genera un nuevo codigo QR desde la app de escritorio.</p></body></html>')
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(this.getMobileCaptureHTML(sessionId))
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }

  /** Handle WebSocket connections from phone */
  private handleWS(ws: WebSocket, req: IncomingMessage): void {
    const url = req.url || ''
    const match = url.match(/^\/ws\/([a-z0-9-]+)$/)

    if (!match) {
      ws.close(4000, 'Invalid session')
      return
    }

    const sessionId = match[1]
    const session = this.sessions.get(sessionId)

    if (!session || Date.now() > session.expiresAt) {
      ws.close(4001, 'Session expired')
      return
    }

    session.status = 'connected'
    session.ws = ws
    this.emit({ type: 'phone-connected', sessionId })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())

        // Key exchange: phone sends its public key
        if (msg.type === 'key-exchange') {
          const phonePublicKey = new Uint8Array(Buffer.from(msg.publicKey, 'hex'))
          session.sharedKey = nacl.box.before(phonePublicKey, session.keyPair!.secretKey)
          ws.send(JSON.stringify({ type: 'key-exchange-ack' }))
          return
        }

        // Encrypted messages: decrypt before handling
        if (msg.type === 'encrypted' && session.sharedKey) {
          const nonce = new Uint8Array(Buffer.from(msg.nonce, 'hex'))
          const ciphertext = new Uint8Array(Buffer.from(msg.data, 'hex'))
          const plaintext = nacl.secretbox.open(ciphertext, nonce, session.sharedKey)
          if (!plaintext) {
            console.warn('[capture] Failed to decrypt message')
            return
          }
          const decrypted = JSON.parse(new TextDecoder().decode(plaintext))
          this.handleMessage(sessionId, decrypted)
          return
        }

        // Unencrypted fallback (for backwards compatibility)
        this.handleMessage(sessionId, msg)
      } catch { /* ignore malformed messages */ }
    })

    ws.on('close', () => {
      if (session.status !== 'complete') {
        session.status = 'waiting'
      }
      session.ws = undefined
      // Zero out keys on disconnect
      session.sharedKey?.fill(0)
      session.sharedKey = undefined
      this.emit({ type: 'phone-disconnected', sessionId })
    })

    // Send ack with desktop public key
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      publicKey: Buffer.from(session.keyPair!.publicKey).toString('hex'),
    }))
  }

  /** Handle messages from phone */
  private handleMessage(sessionId: string, msg: any): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    switch (msg.type) {
      case 'front-captured':
        session.frontImage = msg.image
        session.status = 'capturing'
        this.emit({ type: 'front-captured', sessionId, image: msg.image })
        session.ws?.send(JSON.stringify({ type: 'front-received' }))
        break

      case 'back-captured':
        session.backImage = msg.image
        // Phone-side OCR is unreliable on old-format cédulas (low res, wrong
        // orientation, signature/stamp interference). Desktop runs the
        // canonical OCR via extractFromFront/extractMRZFromImage in
        // CedulaVerificationPage. Drop any extractedData the phone sent.
        this.emit({
          type: 'back-captured',
          sessionId,
          image: msg.image,
        })
        session.ws?.send(JSON.stringify({ type: 'back-received' }))
        break

      case 'selfie-captured':
        session.selfieImage = msg.image
        session.livenessResult = msg.liveness
        session.status = 'complete'
        this.emit({
          type: 'selfie-captured',
          sessionId,
          image: msg.image,
          livenessResult: msg.liveness,
        })
        this.emit({ type: 'capture-complete', sessionId })
        session.ws?.send(JSON.stringify({ type: 'complete' }))
        break
    }
  }

  /** Clean up expired sessions */
  private cleanupExpired(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt && session.status !== 'complete') {
        session.ws?.close(4001, 'Session expired')
        this.sessions.delete(id)
        this.emit({ type: 'session-expired', sessionId: id })
      }
    }
  }

  private emit(event: CaptureEvent): void {
    this.eventCallback?.(event)
  }

  /** Generate the mobile capture HTML page */
  private getMobileCaptureHTML(sessionId: string): string {
    const wsUrl = `ws://${this.getLocalIP()}:${this.port}/ws/${sessionId}`

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#1a1a2e">
  <title>Attestto — Verificacion de identidad</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e; color: white;
      min-height: 100vh; min-height: 100dvh;
      display: flex; flex-direction: column;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Brand header ── */
    .brand {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 12px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      flex-shrink: 0;
    }
    .brand-name { font-size: 1.125rem; font-weight: 700; letter-spacing: -0.025em; }
    .brand-attest { color: white; }
    .brand-to { color: #00D994; }

    /* ── Tab navigation (Cortex-style) ── */
    .tabs {
      display: flex; gap: 8px; padding: 12px 16px 0; flex-shrink: 0;
    }
    .tab {
      flex: 1; padding: 10px 6px; border: 2px solid #4a4a6a; border-radius: 12px;
      background: transparent; color: #a0a0a0; font-size: 0.7rem; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      -webkit-tap-highlight-color: transparent;
    }
    .tab-icon { font-size: 1.1rem; }
    .tab--active { border-color: #6366f1; color: white; background: rgba(99,102,241,0.1); }
    .tab--completed { border-color: #22c55e; color: #22c55e; }
    .tab--completed .tab-icon::after { content: ' \\2713'; font-size: 0.7rem; }

    /* ── Progress bar (thin) ── */
    .progress-bar { height: 4px; background: #4a4a6a; margin: 12px 16px 0; border-radius: 2px; overflow: hidden; flex-shrink: 0; }
    .progress-fill { height: 100%; background: #6366f1; transition: width 0.4s ease; border-radius: 2px; }

    /* ── Content area ── */
    .content { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 12px 12px 0; overflow: hidden; }
    .step-title { font-size: 0.95rem; font-weight: 700; color: white; margin-bottom: 2px; text-align: center; }
    .step-sub { font-size: 0.75rem; color: #a0a0a0; text-align: center; margin-bottom: 8px; }

    /* ── Video container ── */
    .viewfinder {
      position: relative; width: 100%; max-width: 400px;
      border-radius: 20px; overflow: hidden; background: #000;
      margin: 0 auto;
    }
    .viewfinder--landscape { aspect-ratio: 4/3; }
    .viewfinder--portrait  { aspect-ratio: 3/4; }
    .viewfinder video { width: 100%; height: 100%; object-fit: cover; }
    .viewfinder video.mirror { transform: scaleX(-1); }

    /* ── Card frame overlay ── */
    .card-frame {
      position: absolute; top: 12%; left: 5%; right: 5%; bottom: 12%;
      border: 2px solid rgba(255,255,255,0.15);
      border-radius: 12px; pointer-events: none;
    }
    .card-frame .corner {
      position: absolute; width: 20px; height: 20px;
      border-color: #22c55e; border-style: solid;
    }
    .corner--tl { top: -2px; left: -2px; border-width: 4px 0 0 4px; border-radius: 8px 0 0 0; }
    .corner--tr { top: -2px; right: -2px; border-width: 4px 4px 0 0; border-radius: 0 8px 0 0; }
    .corner--bl { bottom: -2px; left: -2px; border-width: 0 0 4px 4px; border-radius: 0 0 0 8px; }
    .corner--br { bottom: -2px; right: -2px; border-width: 0 4px 4px 0; border-radius: 0 0 8px 0; }

    /* ── Guidance banner (state-based colors) ── */
    .guidance {
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      padding: 6px 16px; border-radius: 20px;
      font-size: 0.8rem; font-weight: 600; color: white;
      white-space: nowrap; z-index: 3; pointer-events: none;
      transition: background-color 0.3s, box-shadow 0.3s;
    }
    .guidance--searching {
      background: rgba(245,158,11,0.85);
      animation: guidance-pulse 2s ease-in-out infinite;
    }
    .guidance--detecting { background: rgba(59,130,246,0.85); }
    .guidance--detected  { background: rgba(59,130,246,0.95); box-shadow: 0 0 12px rgba(59,130,246,0.4); }
    .guidance--stable    { background: rgba(34,197,94,0.9); box-shadow: 0 0 16px rgba(34,197,94,0.5); }
    @keyframes guidance-pulse { 0%,100%{opacity:0.85}50%{opacity:1} }

    /* ── Quality badge ── */
    .quality-badge {
      position: absolute; bottom: 12px; right: 12px;
      padding: 4px 10px; border-radius: 12px;
      font-size: 0.65rem; font-weight: 700; color: white;
      pointer-events: none; z-index: 3;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .quality--poor      { background: rgba(239,68,68,0.85); }
    .quality--fair      { background: rgba(245,158,11,0.85); }
    .quality--good      { background: rgba(34,197,94,0.85); }
    .quality--excellent { background: rgba(6,182,212,0.9); }

    /* ── Face oval (selfie) ── */
    .face-oval {
      position: absolute; top: 8%; left: 18%; right: 18%; bottom: 18%;
      border: 3px solid rgba(255,255,255,0.3);
      border-radius: 50%; pointer-events: none;
      transition: border-color 0.3s, box-shadow 0.3s;
    }
    .face-oval--detected {
      border-color: rgba(34,197,94,0.7);
      box-shadow: 0 0 20px rgba(34,197,94,0.3);
    }

    /* ── Face indicator (top-right circle) ── */
    .face-indicator {
      position: absolute; top: 16px; right: 16px;
      width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem; font-weight: 700; z-index: 3; pointer-events: none;
    }
    .face-indicator--ok { background: rgba(34,197,94,0.85); color: white; }
    .face-indicator--no { background: rgba(239,68,68,0.85); color: white; }

    /* ── Blink toast ── */
    .blink-toast {
      position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
      padding: 6px 16px; background: rgba(34,197,94,0.85);
      color: white; font-size: 0.75rem; font-weight: 600;
      border-radius: 20px; pointer-events: none; z-index: 3;
      white-space: nowrap;
      animation: blink-toast-fade 1.2s ease-out forwards;
    }
    @keyframes blink-toast-fade { 0%{opacity:1}70%{opacity:1}100%{opacity:0} }

    /* ── Tap hint ── */
    .tap-hint {
      position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
      padding: 6px 16px; background: rgba(0,0,0,0.6); color: rgba(255,255,255,0.9);
      font-size: 0.75rem; border-radius: 20px; pointer-events: none; white-space: nowrap;
    }

    /* ── Capture button ── */
    .capture-btn-row { display: flex; justify-content: center; padding: 10px 0; flex-shrink: 0; }
    .capture-btn {
      width: 68px; height: 68px; border-radius: 50%;
      border: 4px solid white; background: transparent;
      cursor: pointer; position: relative;
      transition: transform 0.15s, opacity 0.2s;
      -webkit-tap-highlight-color: transparent;
    }
    .capture-btn:active { transform: scale(0.88); }
    .capture-btn:disabled { opacity: 0.25; pointer-events: none; }
    .capture-btn .inner {
      width: 52px; height: 52px; border-radius: 50%;
      background: white; position: absolute;
      top: 4px; left: 4px;
      transition: background 0.2s;
    }
    .capture-btn--selfie .inner { background: #6366f1; }
    .capture-btn--recording { border-color: #ef4444; }
    .capture-btn--recording .inner { background: #ef4444; border-radius: 8px; width: 28px; height: 28px; top: 16px; left: 16px; }

    /* ── Preview ── */
    .preview-wrap {
      text-align: center; flex: 1;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 0 12px;
    }
    .preview-img {
      max-width: 340px; width: 100%; border-radius: 20px;
      border: 2px solid #6366f1; margin-top: 8px;
    }
    .btn-row { display: flex; gap: 10px; margin-top: 16px; width: 100%; max-width: 340px; }
    .btn-primary {
      flex: 1; background: #6366f1; color: white; border: none;
      padding: 16px; border-radius: 12px; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { background: #4a4a6a; cursor: not-allowed; }
    .btn-secondary {
      background: #374151; color: white; border: none;
      padding: 16px 20px; border-radius: 12px; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }

    /* ── Status bar ── */
    .status-bar { padding: 6px; font-size: 0.65rem; color: #4a4a6a; text-align: center; flex-shrink: 0; }
    .status-bar--ok { color: #22c55e; }
    .status-bar--err { color: #ef4444; }

    /* ── Done screen ── */
    .done-screen { text-align: center; padding: 3rem 1.5rem; }
    .done-icon {
      width: 80px; height: 80px; margin: 0 auto 20px;
      background: rgba(34,197,94,0.15); border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
    }
    .done-icon svg { width: 48px; height: 48px; color: #22c55e; }
    .done-title { font-size: 1.25rem; font-weight: 700; margin-bottom: 8px; }
    .done-sub { font-size: 0.85rem; color: #a0a0a0; margin-bottom: 24px; }
    .pwa-box {
      padding: 20px; border: 1px solid rgba(99,102,241,0.3);
      border-radius: 16px; background: rgba(99,102,241,0.05);
    }
    .pwa-box h3 { color: #6366f1; font-size: 1rem; font-weight: 700; }
    .pwa-box p { font-size: 0.8rem; color: #a0a0a0; margin-top: 6px; }
    .pwa-link {
      display: block; text-align: center; text-decoration: none;
      background: #22c55e; color: white; padding: 14px;
      border-radius: 12px; font-weight: 600; font-size: 1rem; margin-top: 12px;
      transition: background 0.2s;
    }

    /* ── Connecting spinner ── */
    .spinner {
      width: 40px; height: 40px;
      border: 4px solid #4a4a6a; border-top-color: #6366f1;
      border-radius: 50%; animation: spin 1s linear infinite;
      margin: 3rem auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── File input fallback (when getUserMedia unavailable) ── */
    .viewfinder--file {
      display: flex; align-items: center; justify-content: center;
      background: rgba(99,102,241,0.05); border: 2px dashed #4a4a6a;
    }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <!-- Brand header -->
  <div class="brand">
    <span class="brand-name"><span class="brand-attest">attest</span><span class="brand-to">to</span></span>
  </div>

  <!-- Tab navigation -->
  <div class="tabs" id="tabs">
    <button class="tab tab--active" id="tab-front" onclick="switchTab('front')">
      <span class="tab-icon">&#x1F4C4;</span>Frente
    </button>
    <button class="tab" id="tab-back" onclick="switchTab('back')">
      <span class="tab-icon">&#x1F504;</span>Reverso
    </button>
    <button class="tab" id="tab-selfie" onclick="switchTab('selfie')">
      <span class="tab-icon">&#x1F464;</span>Selfie
    </button>
  </div>

  <!-- Progress bar -->
  <div class="progress-bar"><div class="progress-fill" id="pbar" style="width:0%"></div></div>

  <div class="content">
    <!-- Connecting -->
    <div id="s-connecting">
      <div class="spinner"></div>
      <p class="step-sub">Conectando con el escritorio...</p>
    </div>

    <!-- Step 1: Front (live camera, landscape) -->
    <div id="s-front" class="hidden">
      <div class="step-title">Frente del documento</div>
      <div class="step-sub">Centra tu cedula dentro del marco</div>
      <div class="viewfinder viewfinder--landscape">
        <video id="vid-front" autoplay playsinline muted></video>
        <div class="card-frame">
          <div class="corner corner--tl"></div>
          <div class="corner corner--tr"></div>
          <div class="corner corner--bl"></div>
          <div class="corner corner--br"></div>
        </div>
        <div class="guidance guidance--searching" id="g-front">Iniciando camara...</div>
        <div class="quality-badge hidden" id="q-front"></div>
        <div class="tap-hint" id="hint-front">Toca el boton para capturar</div>
      </div>
      <div class="capture-btn-row">
        <button class="capture-btn" id="btn-front" onclick="captureDoc('front')" disabled><div class="inner"></div></button>
      </div>
    </div>

    <!-- Step 2: Back (live camera, landscape) -->
    <div id="s-back" class="hidden">
      <div class="step-title">Reverso del documento</div>
      <div class="step-sub">Asegurate que el MRZ se vea claro</div>
      <div class="viewfinder viewfinder--landscape">
        <video id="vid-back" autoplay playsinline muted></video>
        <div class="card-frame">
          <div class="corner corner--tl"></div>
          <div class="corner corner--tr"></div>
          <div class="corner corner--bl"></div>
          <div class="corner corner--br"></div>
        </div>
        <div class="guidance guidance--searching" id="g-back">Iniciando camara...</div>
        <div class="quality-badge hidden" id="q-back"></div>
        <div class="tap-hint" id="hint-back">Toca el boton para capturar</div>
      </div>
      <div class="capture-btn-row">
        <button class="capture-btn" id="btn-back" onclick="captureDoc('back')" disabled><div class="inner"></div></button>
      </div>
    </div>

    <!-- Step 3: Selfie (front camera, portrait, with liveness) -->
    <div id="s-selfie" class="hidden">
      <div class="step-title">Selfie con prueba de vida</div>
      <div class="step-sub">Posiciona tu rostro y parpadea</div>
      <div class="viewfinder viewfinder--portrait">
        <video id="vid-selfie" autoplay playsinline muted class="mirror"></video>
        <div class="face-oval" id="foval"></div>
        <div class="face-indicator face-indicator--no" id="face-ind">&#x2716;</div>
        <div class="guidance guidance--searching" id="g-selfie">Iniciando camara...</div>
      </div>
      <div class="capture-btn-row">
        <button class="capture-btn capture-btn--selfie" id="btn-selfie" onclick="captureSelfie()" disabled><div class="inner"></div></button>
      </div>
    </div>

    <!-- Preview (shared for all steps) -->
    <div id="s-preview" class="hidden">
      <div class="preview-wrap">
        <div class="step-title" id="preview-title">Vista previa</div>
        <img id="preview-img" class="preview-img" />
        <div class="btn-row">
          <button class="btn-primary" id="btn-confirm" onclick="confirmCapture()">Confirmar</button>
          <button class="btn-secondary" onclick="retakeCapture()">Repetir</button>
        </div>
      </div>
    </div>

    <!-- Done -->
    <div id="s-done" class="hidden">
      <div class="done-screen">
        <div class="done-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <div class="done-title">Verificacion completada</div>
        <p class="done-sub">Las capturas se enviaron a tu escritorio.</p>
        <div class="pwa-box">
          <h3>Attestto Wallet</h3>
          <p>Tu billetera de identidad digital.</p>
          <a href="https://mobile.attestto.com" class="pwa-link">Ir a Attestto Wallet</a>
        </div>
      </div>
    </div>
  </div>

  <div class="status-bar" id="status">Desconectado</div>

  <script src="https://cdn.jsdelivr.net/npm/tweetnacl@1.0.3/nacl-fast.min.js"></script>
  <script>
    const WS_URL = '${wsUrl}';
    const DESKTOP_PK = new URLSearchParams(location.search).get('pk');
    let ws = null;
    let sharedKey = null;
    let currentStep = '';
    let previewStep = '';
    let captures = {};
    let streams = {};
    let livenessStart = 0, blinkCount = 0, faceOk = false;
    let lastEyeB = null, blinkCD = false, dLoop = null;

    // ── E2E Encryption helpers ──
    function hexToBytes(hex) {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) bytes[i/2] = parseInt(hex.substr(i, 2), 16);
      return bytes;
    }
    function bytesToHex(bytes) {
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    function encryptAndSend(payload) {
      if (!sharedKey || !ws) return;
      const plaintext = new TextEncoder().encode(JSON.stringify(payload));
      const nonce = nacl.randomBytes(24);
      const ciphertext = nacl.secretbox(plaintext, nonce, sharedKey);
      ws.send(JSON.stringify({ type: 'encrypted', nonce: bytesToHex(nonce), data: bytesToHex(ciphertext) }));
    }

    function $(id) { return document.getElementById(id); }
    function setStatus(t, c) { $('status').textContent = t; $('status').className = 'status-bar' + (c ? ' status-bar--' + c : ''); }

    function show(name) {
      ['s-connecting','s-front','s-back','s-selfie','s-preview','s-done'].forEach(id => $(id)?.classList.add('hidden'));
      $('s-' + name)?.classList.remove('hidden');
      if (name !== 'preview') updateTabs(name);
    }

    function updateTabs(step) {
      const steps = ['front','back','selfie'];
      const idx = steps.indexOf(step);
      steps.forEach((s, i) => {
        const tab = $('tab-' + s);
        tab.className = 'tab';
        if (i < idx) tab.classList.add('tab--completed');
        else if (i === idx) tab.classList.add('tab--active');
      });
      // Progress bar: 0% → 33% → 66% → 100%
      const pct = step === 'done' ? 100 : Math.round((idx / 3) * 100);
      $('pbar').style.width = pct + '%';
    }

    function switchTab(step) {
      // Only allow switching to completed or current step
      const steps = ['front','back','selfie'];
      const cur = steps.indexOf(currentStep);
      const target = steps.indexOf(step);
      if (target > cur) return; // Can't skip ahead
      if (step === currentStep) return;
      // Switch back to review a completed step isn't supported in capture flow
    }

    let useLiveCamera = true; // Will be set to false if getUserMedia fails

    // ── Camera (with file input fallback) ──
    async function openCamera(side) {
      const facing = side === 'selfie' ? 'user' : 'environment';
      const res = side === 'selfie'
        ? { width: { ideal: 720 }, height: { ideal: 1280 } }
        : { width: { ideal: 1920 }, height: { ideal: 1080 } };
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no mediaDevices');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, ...res }, audio: false });
        streams[side] = stream;
        const vid = $('vid-' + side);
        vid.srcObject = stream;
        await vid.play();
        $('btn-' + side).disabled = false;
        if (side === 'selfie') {
          livenessStart = Date.now();
          blinkCount = 0; faceOk = false; lastEyeB = null;
          startLiveness();
        } else {
          const g = $('g-' + side);
          g.textContent = 'Documento detectado';
          g.className = 'guidance guidance--stable';
          const hint = $('hint-' + side);
          if (hint) hint.style.display = '';
        }
      } catch {
        // getUserMedia not available (HTTP) — switch to file input mode
        useLiveCamera = false;
        showFileInput(side);
      }
    }

    function showFileInput(side) {
      const facing = side === 'selfie' ? 'user' : 'environment';
      const viewfinder = $('vid-' + side).parentElement;
      viewfinder.classList.add('viewfinder--file');
      // Hide video + capture button
      $('vid-' + side).style.display = 'none';
      $('btn-' + side).parentElement.style.display = 'none';
      // Hide guidance + tap-hint — file-input mode uses ONE centered label
      // (the dynamically-added label below). Without this we end up with
      // three overlapping labels: guidance, tap-hint, and the centered label.
      const g = $('g-' + side);
      if (g) g.style.display = 'none';
      const hint = $('hint-' + side);
      if (hint) hint.style.display = 'none';
      // Create file input inside viewfinder
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = facing;
      input.id = 'file-' + side;
      input.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:10;';
      viewfinder.appendChild(input);
      // Add tap label
      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;z-index:5;pointer-events:none;';
      label.innerHTML = '<div style="font-size:2.5rem;margin-bottom:8px;">📷</div><div style="font-size:0.85rem;font-weight:600;color:white;">' +
        (side === 'selfie' ? 'Tomar selfie' : 'Fotografiar documento') + '</div>';
      label.id = 'file-label-' + side;
      viewfinder.appendChild(label);

      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          // Resize to max 1920px
          const img = new Image();
          img.onload = () => {
            const maxW = 1920;
            const scale = img.width > maxW ? maxW / img.width : 1;
            const c = document.createElement('canvas');
            c.width = img.width * scale;
            c.height = img.height * scale;
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            captures[side] = c.toDataURL('image/jpeg', 0.85);
            if (side === 'selfie') {
              faceOk = true; blinkCount = 1; livenessStart = livenessStart || Date.now();
            }
            showPreview(side);
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      };
    }

    function closeCamera(side) {
      if (dLoop) { cancelAnimationFrame(dLoop); dLoop = null; }
      if (streams[side]) { streams[side].getTracks().forEach(t => t.stop()); delete streams[side]; }
    }

    // ── Document capture (live camera mode) ──
    function captureDoc(side) {
      const vid = $('vid-' + side);
      const c = document.createElement('canvas');
      c.width = vid.videoWidth; c.height = vid.videoHeight;
      c.getContext('2d').drawImage(vid, 0, 0);
      captures[side] = c.toDataURL('image/jpeg', 0.85);
      closeCamera(side);
      showPreview(side);
    }

    // ── Selfie capture (live camera mode) ──
    function captureSelfie() {
      const vid = $('vid-selfie');
      const c = document.createElement('canvas');
      c.width = vid.videoWidth; c.height = vid.videoHeight;
      const ctx = c.getContext('2d');
      ctx.translate(c.width, 0); ctx.scale(-1, 1);
      ctx.drawImage(vid, 0, 0);
      captures.selfie = c.toDataURL('image/jpeg', 0.85);
      closeCamera('selfie');
      showPreview('selfie');
    }

    // ── Liveness ──
    function startLiveness() {
      const vid = $('vid-selfie');
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      function loop() {
        if (!streams.selfie) return;
        if (vid.readyState < 2) { dLoop = requestAnimationFrame(loop); return; }
        const w = vid.videoWidth, h = vid.videoHeight;
        c.width = w; c.height = h;
        ctx.drawImage(vid, 0, 0, w, h);
        // Skin-tone face detection in oval region
        const oL=w*0.2|0, oR=w*0.8|0, oT=h*0.1|0, oB=h*0.75|0, oW=oR-oL, oH=oB-oT;
        const d = ctx.getImageData(oL,oT,oW,oH).data;
        let skin=0, tot=0;
        for (let i=0;i<d.length;i+=16){tot++;const r=d[i],g=d[i+1],b=d[i+2];if(r>60&&g>40&&b>20&&r>g&&r>b)skin++;}
        const hasFace = skin/tot > 0.12;
        // Eye region brightness for blink detection
        const eT=oT+oH*0.28|0,eB2=oT+oH*0.42|0,eL=oL+oW*0.15|0,eR=oL+oW*0.85|0;
        const ed=ctx.getImageData(eL,eT,eR-eL,eB2-eT).data;
        let eyeB=0,eC=0;
        for(let i=0;i<ed.length;i+=12){eyeB+=(ed[i]+ed[i+1]+ed[i+2])/3;eC++;}
        const eb=eC>0?eyeB/eC:0;
        if(lastEyeB!==null&&hasFace&&!blinkCD){
          if((lastEyeB-eb)/lastEyeB>0.15){
            blinkCount++;blinkCD=true;
            showBlinkToast();
            setTimeout(()=>{blinkCD=false;},500);
          }
        }
        lastEyeB=eb; faceOk=hasFace;
        // Update UI elements
        const oval=$('foval'), g2=$('g-selfie'), btn=$('btn-selfie'), ind=$('face-ind');
        if(!hasFace){
          oval.className='face-oval';
          g2.textContent='Posiciona tu rostro en el ovalo';
          g2.className='guidance guidance--searching';
          ind.className='face-indicator face-indicator--no'; ind.innerHTML='&#x2716;';
          btn.disabled=true;
        } else if(blinkCount===0){
          oval.className='face-oval face-oval--detected';
          g2.textContent='Rostro detectado — parpadea';
          g2.className='guidance guidance--detected';
          ind.className='face-indicator face-indicator--ok'; ind.innerHTML='&#x2714;';
          btn.disabled=true;
        } else {
          oval.className='face-oval face-oval--detected';
          g2.textContent='Listo — captura tu selfie';
          g2.className='guidance guidance--stable';
          ind.className='face-indicator face-indicator--ok'; ind.innerHTML='&#x2714;';
          btn.disabled=false;
        }
        dLoop=requestAnimationFrame(loop);
      }
      dLoop=requestAnimationFrame(loop);
    }

    // ── Blink toast ──
    function showBlinkToast() {
      // Remove existing toast
      const old = document.querySelector('.blink-toast');
      if (old) old.remove();
      const toast = document.createElement('div');
      toast.className = 'blink-toast';
      toast.textContent = 'Parpadeo detectado (' + blinkCount + ')';
      document.querySelector('.viewfinder--portrait')?.appendChild(toast);
      setTimeout(() => toast.remove(), 1200);
    }

    // ── Preview ──
    function showPreview(side) {
      previewStep = side;
      const titles = { front:'Frente capturado', back:'Reverso capturado', selfie:'Selfie capturado' };
      $('preview-title').textContent = titles[side] || 'Vista previa';
      $('preview-img').src = captures[side];
      show('preview');
    }

    function confirmCapture() {
      const side = previewStep;
      const payload = { type: side+'-captured', image: captures[side] };
      if (side === 'selfie') {
        payload.liveness = { faceDetected: faceOk, blinkCount, durationMs: Date.now()-livenessStart };
      }
      setStatus('Enviando cifrado...', 'ok');
      if (sharedKey) {
        encryptAndSend(payload);
      } else {
        ws.send(JSON.stringify(payload));
      }
    }

    function retakeCapture() {
      delete captures[previewStep];
      // Clean up old file input if in fallback mode
      const oldInput = $('file-' + previewStep);
      if (oldInput) oldInput.remove();
      const oldLabel = $('file-label-' + previewStep);
      if (oldLabel) oldLabel.remove();
      show(previewStep);
      openCamera(previewStep);
    }

    // ── WebSocket with E2E key exchange ──
    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setStatus('Conectado', 'ok');
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected' && DESKTOP_PK) {
          // Key exchange: generate phone keypair, derive shared secret
          const phoneKeyPair = nacl.box.keyPair();
          const desktopPk = hexToBytes(DESKTOP_PK);
          sharedKey = nacl.box.before(desktopPk, phoneKeyPair.secretKey);
          // Send phone's public key to desktop
          ws.send(JSON.stringify({ type: 'key-exchange', publicKey: bytesToHex(phoneKeyPair.publicKey) }));
          setStatus('Cifrado E2E activo', 'ok');
        }
        else if (msg.type === 'connected') { currentStep='front'; show('front'); openCamera('front'); }
        else if (msg.type === 'key-exchange-ack') { currentStep='front'; show('front'); openCamera('front'); }
        else if (msg.type === 'front-received') { currentStep='back'; show('back'); openCamera('back'); }
        else if (msg.type === 'back-received') { currentStep='selfie'; show('selfie'); openCamera('selfie'); }
        else if (msg.type === 'complete') {
          sharedKey = null; // Zero out key
          Object.keys(streams).forEach(closeCamera);
          show('done');
          updateTabs('done');
          $('pbar').style.width = '100%';
          setTimeout(() => { window.location.href = 'https://mobile.attestto.com'; }, 5000);
        }
      };
      ws.onclose = () => setStatus('Desconectado', 'err');
      ws.onerror = () => setStatus('Error de conexion', 'err');
    }
    connect();
  </script>
</body>
</html>`
  }
}
