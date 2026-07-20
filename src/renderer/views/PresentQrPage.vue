<script setup lang="ts">
// Holder-side presentation: the DESKTOP shows a QR that the MOBILE app scans.
// The QR carries only a connection engagement (attestto-present://…), never the
// credential. The phone connects over the LAN nacl channel (reused capture
// server), sends a challenge nonce, and the desktop replies with a VP signed
// over that nonce. Replay-safe: the VP is bound to the phone's per-connection
// challenge. See ATT-1044 / ATT-1045.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import { usePresentation } from '../composables/usePresentation'
import type { VaultCredential } from '../../shared/vault-api'

type PresentEvent =
  | { type: 'present-connected'; sessionId: string }
  | { type: 'present-challenge'; sessionId: string; nonce: string; domain?: string }
  | { type: 'present-complete'; sessionId: string }
  | { type: string; sessionId?: string }

const route = useRoute()
const router = useRouter()
const { buildSignedPresentation } = usePresentation()

type Step = 'starting' | 'waiting' | 'connected' | 'signing' | 'done' | 'error'
const step = ref<Step>('starting')
const qrDataUrl = ref('')
const errorMsg = ref('')
const credential = ref<VaultCredential | null>(null)

let sessionId = ''
let unsubscribe: (() => void) | null = null

const api = () => (window as unknown as { presenciaAPI?: any }).presenciaAPI

async function loadCredential(): Promise<VaultCredential | null> {
  const cid = route.query.cid as string | undefined
  const contents = await api()?.vault?.read()
  const list: VaultCredential[] = contents?.credentials ?? []
  if (!list.length) return null
  if (cid) {
    const found = list.find((c) => (c as { id?: string }).id === cid)
    if (found) return found
  }
  return list[0] // fallback: first credential
}

async function handleEvent(ev: PresentEvent) {
  if (ev.sessionId && ev.sessionId !== sessionId) return
  if (ev.type === 'present-connected') {
    step.value = 'connected'
  } else if (ev.type === 'present-challenge') {
    step.value = 'signing'
    const cred = credential.value
    if (!cred) {
      errorMsg.value = 'No hay credencial para presentar'
      step.value = 'error'
      return
    }
    const vp = await buildSignedPresentation({
      credential: cred,
      nonce: (ev as { nonce: string }).nonce,
      domain: (ev as { domain?: string }).domain,
    })
    if (!vp) {
      errorMsg.value = 'No se pudo firmar la presentación'
      step.value = 'error'
      return
    }
    await api()?.capture?.submitPresentation(sessionId, vp)
  } else if (ev.type === 'present-complete') {
    step.value = 'done'
  }
}

onMounted(async () => {
  try {
    credential.value = await loadCredential()
    if (!credential.value) {
      errorMsg.value = 'No hay credenciales en la bóveda'
      step.value = 'error'
      return
    }
    unsubscribe = api()?.capture?.onEvent(handleEvent) ?? null
    await api()?.capture?.startServer()
    const session = await api()?.capture?.createPresentSession()
    sessionId = session.sessionId
    qrDataUrl.value = await QRCode.toDataURL(session.url, { width: 300, margin: 2 })
    step.value = 'waiting'
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Error al iniciar la presentación'
    step.value = 'error'
  }
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

function goBack() {
  router.back()
}
</script>

<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <q-btn flat round icon="arrow_back" @click="goBack" />
      <div class="text-h5 q-ml-sm">Presentar credencial</div>
    </div>

    <div class="column items-center q-gutter-md" style="max-width: 460px; margin: 0 auto;">
      <p class="text-grey text-center">
        Mostrá este código al verificador. Escaneálo con la app móvil de Attestto
        para recibir tu presentación firmada.
      </p>

      <!-- Starting -->
      <div v-if="step === 'starting'" class="column items-center q-gutter-sm q-pa-lg">
        <q-spinner size="40px" color="primary" />
        <span class="text-grey">Iniciando sesión de presentación...</span>
      </div>

      <!-- Error -->
      <div v-else-if="step === 'error'" class="text-negative text-center q-pa-lg">
        {{ errorMsg }}
      </div>

      <!-- Done -->
      <div v-else-if="step === 'done'" class="column items-center q-gutter-sm q-pa-lg">
        <q-icon name="check_circle" color="positive" size="56px" />
        <div class="text-h6">Presentación enviada</div>
        <p class="text-grey text-center">
          El verificador recibió tu presentación firmada contra su desafío.
        </p>
        <q-btn unelevated color="primary" label="Listo" @click="goBack" />
      </div>

      <!-- QR + live status -->
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
          <template #avatar>
            <q-spinner size="20px" />
          </template>
          {{ step === 'connected' ? 'Teléfono conectado — esperando desafío...' : 'Firmando presentación...' }}
        </q-banner>
        <div v-else class="text-caption text-grey text-center">
          Esperando que el verificador escanee...
        </div>

        <div class="info-banner q-mt-sm">
          <q-icon name="lock" size="16px" color="grey-6" />
          <span class="att-text-muted" style="font-size: var(--att-text-xs);">
            El QR solo contiene la conexión (clave efímera + dirección local), nunca la
            credencial. La presentación se firma contra el desafío del verificador.
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
