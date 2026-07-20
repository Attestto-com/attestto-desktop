<script setup lang="ts">
// Holder-side presentation over the RELAY. The desktop is the holder: it shows a
// QR pointing at the hosted verifier page (mobile.attestto.com/present.html). The
// phone opens that over HTTPS (no iOS ws-to-LAN wall) and both peers rendezvous
// through a blind relay. The QR carries only the connection engagement
// (relay + session id + ephemeral pubkey) — never the credential. The desktop
// answers the phone's challenge with a VP signed over its nonce (replay-safe).
// Everything is nacl-sealed E2E to the pubkey in the QR, so the relay sees only
// ciphertext. See ATT-1044 / ATT-1045.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import nacl from 'tweetnacl'
import { usePresentation } from '../composables/usePresentation'
import type { VaultCredential } from '../../shared/vault-api'

// Provider-independent later via relay.attestto.com (ATT-1047 CNAME flip); the
// working Fly URL is the default so this runs today without extra DNS.
const RELAY_WSS = 'wss://attestto-present-relay.fly.dev'
const VERIFY_PAGE = 'https://mobile.attestto.com/present.html'

const route = useRoute()
const router = useRouter()
const { buildSignedPresentation } = usePresentation()

type Step = 'starting' | 'waiting' | 'connected' | 'signing' | 'done' | 'error'
const step = ref<Step>('starting')
const qrDataUrl = ref('')
const errorMsg = ref('')
const credential = ref<VaultCredential | null>(null)

let ws: WebSocket | null = null
let keyPair: nacl.BoxKeyPair | null = null
let sharedKey: Uint8Array | null = null

const api = () => (window as unknown as { presenciaAPI?: any }).presenciaAPI

function hexToBytes(h: string): Uint8Array {
  const a = new Uint8Array(h.length / 2)
  for (let i = 0; i < h.length; i += 2) a[i / 2] = parseInt(h.substr(i, 2), 16)
  return a
}
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}

async function loadCredential(): Promise<VaultCredential | null> {
  const cid = route.query.cid as string | undefined
  const contents = await api()?.vault?.read()
  const list: VaultCredential[] = contents?.credentials ?? []
  if (!list.length) return null
  if (cid) {
    const found = list.find((c) => (c as { id?: string }).id === cid)
    if (found) return found
  }
  return list[0]
}

function sendEncrypted(obj: unknown) {
  if (!ws || !sharedKey) return
  const nonce = nacl.randomBytes(24)
  const ct = nacl.secretbox(new TextEncoder().encode(JSON.stringify(obj)), nonce, sharedKey)
  ws.send(JSON.stringify({ type: 'encrypted', nonce: bytesToHex(nonce), data: bytesToHex(ct) }))
}

async function handleMessage(raw: string) {
  let msg: any
  try { msg = JSON.parse(raw) } catch { return }

  if (msg.type === 'peer-joined') {
    step.value = 'connected'
  } else if (msg.type === 'key-exchange' && typeof msg.publicKey === 'string') {
    // Phone announced itself → derive the shared key and ack.
    sharedKey = nacl.box.before(hexToBytes(msg.publicKey), keyPair!.secretKey)
    ws?.send(JSON.stringify({ type: 'key-exchange-ack' }))
  } else if (msg.type === 'encrypted' && sharedKey) {
    const pt = nacl.secretbox.open(hexToBytes(msg.data), hexToBytes(msg.nonce), sharedKey)
    if (!pt) return
    let inner: any
    try { inner = JSON.parse(new TextDecoder().decode(pt)) } catch { return }
    if (inner.type === 'challenge' && typeof inner.nonce === 'string') {
      step.value = 'signing'
      const cred = credential.value
      if (!cred) { errorMsg.value = 'No hay credencial para presentar'; step.value = 'error'; return }
      const vp = await buildSignedPresentation({ credential: cred, nonce: inner.nonce })
      if (!vp) { errorMsg.value = 'No se pudo firmar la presentación'; step.value = 'error'; return }
      sendEncrypted({ type: 'presentation', vp })
      step.value = 'done'
    }
  } else if (msg.type === 'peer-gone') {
    if (step.value !== 'done') step.value = 'waiting'
  }
}

onMounted(async () => {
  try {
    credential.value = await loadCredential()
    if (!credential.value) { errorMsg.value = 'No hay credenciales en la bóveda'; step.value = 'error'; return }

    keyPair = nacl.box.keyPair()
    const sid = (globalThis.crypto.randomUUID?.() || bytesToHex(nacl.randomBytes(8))).replace(/-/g, '').slice(0, 16)
    const pkHex = bytesToHex(keyPair.publicKey)
    const url = `${VERIFY_PAGE}?relay=${encodeURIComponent(RELAY_WSS)}&sid=${sid}&pk=${pkHex}`
    qrDataUrl.value = await QRCode.toDataURL(url, { width: 300, margin: 2 })

    ws = new WebSocket(`${RELAY_WSS}/r/${sid}`)
    ws.onopen = () => { step.value = 'waiting' }
    ws.onmessage = (e) => handleMessage(String(e.data))
    ws.onerror = () => { if (step.value === 'starting') { errorMsg.value = 'No se pudo conectar al relay'; step.value = 'error' } }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Error al iniciar la presentación'
    step.value = 'error'
  }
})

onBeforeUnmount(() => { ws?.close() })

function goBack() { router.back() }
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <q-btn flat round icon="arrow_back" @click="goBack" />
      <div class="text-h5 q-ml-sm">Presentar credencial</div>
    </div>

    <div class="column items-center q-gutter-md" style="max-width: 460px; margin: 0 auto;">
      <p class="text-grey text-center">
        Mostrá este código al verificador. Escaneálo con la cámara del teléfono
        para recibir tu presentación firmada.
      </p>

      <div v-if="step === 'starting'" class="column items-center q-gutter-sm q-pa-lg">
        <q-spinner size="40px" color="primary" />
        <span class="text-grey">Iniciando sesión de presentación…</span>
      </div>

      <div v-else-if="step === 'error'" class="text-negative text-center q-pa-lg">
        {{ errorMsg }}
      </div>

      <div v-else-if="step === 'done'" class="column items-center q-gutter-sm q-pa-lg">
        <q-icon name="check_circle" color="positive" size="56px" />
        <div class="text-h6">Presentación enviada</div>
        <p class="text-grey text-center">
          El verificador recibió tu presentación firmada contra su desafío.
        </p>
        <q-btn unelevated color="primary" label="Listo" @click="goBack" />
      </div>

      <template v-else>
        <img
          v-if="qrDataUrl"
          :src="qrDataUrl"
          alt="Presentation QR"
          style="width: 300px; height: 300px; border-radius: 12px; background: #fff; padding: 8px;"
        />

        <q-banner
          v-if="step === 'connected' || step === 'signing'"
          dense
          class="bg-primary text-white rounded-borders"
        >
          <template #avatar><q-spinner size="20px" /></template>
          {{ step === 'connected' ? 'Teléfono conectado — esperando desafío…' : 'Firmando presentación…' }}
        </q-banner>
        <div v-else class="text-caption text-grey text-center">
          Esperando que el verificador escanee…
        </div>

        <div class="info-banner q-mt-sm">
          <q-icon name="lock" size="16px" color="grey-6" />
          <span class="att-text-muted" style="font-size: var(--att-text-xs);">
            El QR solo contiene la conexión (clave efímera + relay), nunca la credencial.
            La presentación se firma contra el desafío del verificador y viaja cifrada de
            extremo a extremo.
          </span>
        </div>
      </template>
    </div>
  </q-page>
</template>

<style scoped lang="scss">
.info-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--att-border);
  border-radius: 8px;
  max-width: 360px;
}
</style>
