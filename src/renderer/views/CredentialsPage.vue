<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import QRCode from 'qrcode'
import type { VaultCredential } from '../../shared/vault-api'
import type { CredentialType } from '@attestto/cr-vc-sdk'
import { usePresentation } from '../composables/usePresentation'

// AnyCredential = VaultCredential (which now includes W3C fields) + flexible credentialSubject
type AnyCredential = VaultCredential & {
  credentialSubject?: Record<string, unknown> & { id?: string; cedula?: string; nombre?: string; fechaNacimiento?: string }
}

const router = useRouter()
const $q = useQuasar()

const credentials = ref<AnyCredential[]>([])
const loading = ref(true)
const detailsOpen = ref(false)
const selected = ref<AnyCredential | null>(null)
const showRawJson = ref(false)

// Presentation
const { buildSignedPresentation, presenting, error: presentError } = usePresentation()
const presentDialogOpen = ref(false)
const presentQrUrl = ref('')
const presentVpJson = ref('')

async function presentCredential(c: AnyCredential) {
  presentDialogOpen.value = true
  presentQrUrl.value = ''
  presentVpJson.value = ''

  const vp = await buildSignedPresentation({ credential: c })
  if (!vp) return

  const json = JSON.stringify(vp, null, 2)
  presentVpJson.value = json

  const compact = JSON.stringify(vp)
  if (compact.length <= 2000) {
    try {
      presentQrUrl.value = await QRCode.toDataURL(compact, { width: 300, margin: 2 })
    } catch { /* QR too large, show JSON only */ }
  }
}

onMounted(async () => {
  await loadCredentials()
})

// Dedupe key: same logical credential = same (type, cedula). Newer issuanceDate
// wins. Vault always wins over localStorage when timestamps match.
function dedupeKey(c: AnyCredential): string {
  const t = credentialType(c)
  const ced = subjectCedula(c) || c.id || ''
  return `${t}::${ced}`
}

async function loadCredentials() {
  loading.value = true
  try {
    const byKey = new Map<string, { cred: AnyCredential; source: 'vault' | 'ls' }>()
    const lsKeysToDrop: string[] = []

    const api = window.presenciaAPI?.vault
    if (api) {
      try {
        const contents = await api.read()
        for (const c of contents?.credentials ?? []) {
          const cred = c as AnyCredential
          const key = dedupeKey(cred)
          const existing = byKey.get(key)
          if (!existing || new Date(cred.issuanceDate || 0) > new Date(existing.cred.issuanceDate || 0)) {
            byKey.set(key, { cred, source: 'vault' })
          }
        }
      } catch (err) {
        console.warn('[credentials] vault read failed:', err)
      }
    }

    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i)
      if (!lsKey?.startsWith('attestto-credential-')) continue
      try {
        const c = JSON.parse(localStorage.getItem(lsKey)!) as AnyCredential
        const key = dedupeKey(c)
        const existing = byKey.get(key)
        if (!existing) {
          byKey.set(key, { cred: c, source: 'ls' })
        } else if (existing.source === 'vault') {
          // Vault has the same logical credential — drop the unencrypted ls copy.
          lsKeysToDrop.push(lsKey)
        } else if (new Date(c.issuanceDate || 0) > new Date(existing.cred.issuanceDate || 0)) {
          byKey.set(key, { cred: c, source: 'ls' })
        }
      } catch { /* skip invalid */ }
    }

    // PII hygiene — clean up superseded localStorage entries.
    for (const k of lsKeysToDrop) localStorage.removeItem(k)

    credentials.value = Array.from(byKey.values()).map(v => v.cred)
  } finally {
    loading.value = false
  }
}

// ── Shape helpers ──────────────────────────────────

function isW3c(c: AnyCredential): boolean {
  return !!c.credentialSubject
}

function credentialType(c: AnyCredential): string {
  if (Array.isArray(c.type)) return c.type.find(t => t !== 'VerifiableCredential') || c.type[0] || 'Credential'
  return (c.type as string) || 'Credential'
}

function credentialIcon(c: AnyCredential): string {
  const map: Record<string, string> = {
    CedulaIdentityCredential: 'badge',
    DimexIdentityCredential: 'card_membership',
    PasaporteCredential: 'flight',
    ExamCredential: 'quiz',
    LivenessProof: 'face',
  }
  return map[credentialType(c)] || 'verified_user'
}

function credentialColor(c: AnyCredential): string {
  const map: Record<string, string> = {
    CedulaIdentityCredential: 'positive',
    DimexIdentityCredential: 'info',
    PasaporteCredential: 'accent',
    ExamCredential: 'warning',
    LivenessProof: 'secondary',
  }
  return map[credentialType(c)] || 'primary'
}

function credentialTitle(c: AnyCredential): string {
  const map: Record<string, string> = {
    CedulaIdentityCredential: 'Cédula de Identidad',
    DimexIdentityCredential: 'DIMEX',
    PasaporteCredential: 'Pasaporte',
    ExamCredential: 'Prueba Teórica',
    LivenessProof: 'Prueba de Vida',
  }
  return map[credentialType(c)] || credentialType(c)
}

function subjectName(c: AnyCredential): string {
  if (isW3c(c)) return (c.credentialSubject?.nombre as string) || ''
  const d = (c.data ?? {}) as Record<string, any>
  return d.nombre || ''
}

function subjectCedula(c: AnyCredential): string {
  if (isW3c(c)) return (c.credentialSubject?.cedula as string) || ''
  const d = (c.data ?? {}) as Record<string, any>
  return d.cedula || ''
}

function subjectFechaNac(c: AnyCredential): string {
  if (isW3c(c)) return (c.credentialSubject?.fechaNacimiento as string) || ''
  const d = (c.data ?? {}) as Record<string, any>
  return d.fechaNacimiento || ''
}

function subjectFechaVenc(c: AnyCredential): string {
  if (isW3c(c)) return (c.credentialSubject?.fechaVencimiento as string) || ''
  const d = (c.data ?? {}) as Record<string, any>
  return d.fechaVencimiento || ''
}

/** Padrón format is YYYYMMDD. Render as DD/MM/YYYY. */
function formatPadronDate(raw: string): string {
  if (!raw) return ''
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return raw
}

function isExpired(c: AnyCredential): boolean {
  const raw = subjectFechaVenc(c)
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m) return false
  const exp = new Date(`${m[1]}-${m[2]}-${m[3]}`)
  return exp.getTime() < Date.now()
}

const TRUST_BLURB: Record<string, string> = {
  'A+': 'Verificada con tarjeta inteligente Firma Digital — máxima confianza',
  A: 'Cédula + Padrón + reconocimiento facial + prueba de vida + Firma Digital',
  B: 'Cédula + Padrón Electoral + reconocimiento facial + prueba de vida',
  C: 'Cédula escaneada únicamente — sin cruce con Padrón',
  D: 'Datos auto-declarados — sin verificación',
}

function trustBlurb(level: string): string {
  return TRUST_BLURB[level] || ''
}

function trustLevel(c: AnyCredential): string {
  if (c.trustLevel) return c.trustLevel
  const d = (c.data ?? {}) as Record<string, any>
  return d.trustLevel || ''
}

function trustColor(level: string): string {
  if (level === 'A+' || level === 'A') return 'positive'
  if (level === 'B') return 'primary'
  if (level === 'C') return 'warning'
  return 'grey'
}

function evidence(c: AnyCredential): Record<string, unknown> | null {
  return c.evidence?.[0] ?? null
}

function authorityName(c: AnyCredential): string {
  const ev = evidence(c) as { authorityName?: string } | null
  return ev?.authorityName || 'Tribunal Supremo de Elecciones'
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('es-CR', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return iso
  }
}

function formatDateTime(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return `${d.toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}`
  } catch {
    return iso
  }
}

function provenanceLine(c: AnyCredential): string {
  const e = evidence(c)
  if (!e) return ''
  const auth = e.authorityName || 'TSE'
  const date = formatDate(c.issuanceDate)
  if (e.padronMatch) {
    return `Datos verificados contra el Padrón Electoral del ${auth} el ${date}.`
  }
  return `Documento verificado por ${auth} el ${date}.`
}

function truncateDid(did?: string, head = 22, tail = 8): string {
  if (!did) return '—'
  if (did.length <= head + tail + 3) return did
  return `${did.slice(0, head)}…${did.slice(-tail)}`
}

// ── Actions ────────────────────────────────────────

function openDetails(c: AnyCredential) {
  selected.value = c
  showRawJson.value = false
  detailsOpen.value = true
}

function verifyUrl(c: AnyCredential): string {
  // Encode the full VC as base64url in the fragment — never hits the server.
  // The preview object gives the offer page a teaser to show before the wallet
  // does cryptographic verification.
  const vcPayload = btoa(JSON.stringify(c))
  const preview = btoa(JSON.stringify({
    type: credentialTitle(c),
    issuer: c.issuer?.name || c.issuer?.id || 'Attestto Platform',
    level: trustLevel(c) ? `Nivel ${trustLevel(c)}` : undefined,
    issuedAt: c.issuanceDate || undefined,
  }))
  return `https://verify.attestto.com/offer/#vc=${vcPayload}&v=1&preview=${preview}`
}

async function copyVerifyLink(c: AnyCredential) {
  try {
    await navigator.clipboard.writeText(verifyUrl(c))
    $q.notify({ type: 'positive', message: 'Enlace copiado', timeout: 1500, position: 'top' })
  } catch {
    $q.notify({ type: 'negative', message: 'No se pudo copiar', timeout: 2000, position: 'top' })
  }
}

function openInBrowser(c: AnyCredential) {
  // window.open is intercepted by main process setWindowOpenHandler → shell.openExternal
  window.open(verifyUrl(c), '_blank')
}

function repeatVerification(c: AnyCredential) {
  const t = credentialType(c)
  if (t === 'CedulaIdentityCredential') {
    router.push('/verify/cr/cedula?redo=1')
  } else {
    router.push('/identity')
  }
}

const sortedCredentials = computed(() =>
  [...credentials.value].sort((a, b) =>
    new Date(b.issuanceDate || 0).getTime() - new Date(a.issuanceDate || 0).getTime()
  )
)
</script>

<template>
  <q-page class="page-centered">
    <div class="page-centered__container" style="max-width: 760px;">
      <div class="text-h4 text-weight-bold q-mb-sm">Credenciales</div>
      <div class="att-text-body q-mb-xl">
        Tus documentos verificados, almacenados cifrados en este dispositivo.
      </div>

      <div v-if="loading" class="text-center q-pa-xl">
        <q-spinner-dots size="32px" color="primary" />
      </div>

      <div v-else-if="!credentials.length" class="empty-state q-pa-xl text-center">
        <q-icon name="folder_open" size="48px" color="grey-7" class="q-mb-md" />
        <div class="text-h6 att-text-title q-mb-xs">Sin credenciales</div>
        <div class="att-text-muted q-mb-lg" style="font-size: var(--att-text-sm);">
          Verificá tu identidad con un documento oficial para obtener tu primera credencial.
        </div>
        <q-btn color="primary" label="Verificar identidad" icon="badge" to="/identity" />
      </div>

      <div v-else class="credential-list">
        <div v-for="c in sortedCredentials" :key="c.id" class="credential-card">
          <!-- Header -->
          <div class="credential-card__header">
            <q-avatar :color="credentialColor(c)" text-color="white" size="44px">
              <q-icon :name="credentialIcon(c)" size="22px" />
            </q-avatar>
            <div class="credential-card__title">
              <div class="text-weight-bold" style="font-size: var(--att-text-lg);">
                {{ credentialTitle(c) }}
              </div>
              <div class="trust-row">
                <q-icon name="verified" size="14px" color="positive" />
                <span class="trust-row__label">Verificada por Attestto</span>
                <q-badge
                  v-if="trustLevel(c)"
                  :color="trustColor(trustLevel(c))"
                  :label="`Nivel ${trustLevel(c)}`"
                  class="q-ml-xs"
                />
              </div>
              <div v-if="trustBlurb(trustLevel(c))" class="trust-blurb">
                {{ trustBlurb(trustLevel(c)) }}
              </div>
            </div>
          </div>

          <!-- Identity block -->
          <div class="credential-card__identity">
            <div v-if="subjectName(c)" class="identity-row">
              <span class="identity-label">Nombre</span>
              <span class="identity-value">{{ subjectName(c).toUpperCase() }}</span>
            </div>
            <div v-if="subjectCedula(c)" class="identity-row">
              <span class="identity-label">Cédula</span>
              <span class="identity-value">{{ subjectCedula(c) }}</span>
            </div>
            <div v-if="subjectFechaNac(c)" class="identity-row">
              <span class="identity-label">Fecha de nacimiento</span>
              <span class="identity-value">{{ subjectFechaNac(c) }}</span>
            </div>
            <div class="identity-row">
              <span class="identity-label">Emitida</span>
              <span class="identity-value">{{ formatDate(c.issuanceDate) }}</span>
            </div>
            <div v-if="subjectFechaVenc(c)" class="identity-row">
              <span class="identity-label">Vence</span>
              <span class="identity-value">
                {{ formatPadronDate(subjectFechaVenc(c)) }}
                <q-badge
                  v-if="isExpired(c)"
                  color="negative"
                  label="Vencida"
                  class="q-ml-sm"
                />
              </span>
            </div>
          </div>

          <!-- Provenance -->
          <div v-if="provenanceLine(c)" class="provenance-strip">
            <q-icon name="shield" size="14px" color="positive" />
            <span>{{ provenanceLine(c) }}</span>
            <a class="provenance-strip__link" @click.stop="openDetails(c)">Ver detalles</a>
          </div>

          <!-- Actions -->
          <div class="credential-card__actions">
            <q-btn
              flat
              dense
              icon="qr_code_2"
              label="Presentar"
              size="sm"
              color="accent"
              @click.stop="presentCredential(c)"
            />
            <q-btn
              flat
              dense
              icon="open_in_new"
              label="Verificar en navegador"
              size="sm"
              color="primary"
              @click.stop="openInBrowser(c)"
            />
            <q-btn
              flat
              dense
              icon="link"
              label="Copiar enlace"
              size="sm"
              @click.stop="copyVerifyLink(c)"
            />
            <q-btn
              flat
              dense
              icon="refresh"
              label="Repetir"
              size="sm"
              @click.stop="repeatVerification(c)"
            />
            <q-space />
            <q-btn
              flat
              dense
              icon="info"
              label="Detalles"
              size="sm"
              @click.stop="openDetails(c)"
            />
          </div>
        </div>
      </div>

      <!-- Scan verifier QR -->
      <q-btn
        class="q-mt-lg"
        unelevated
        color="accent"
        icon="qr_code_scanner"
        label="Escanear QR de verificador"
        @click="router.push('/present')"
      />

      <div class="info-banner q-mt-md">
        <q-icon name="lock" size="16px" color="grey-6" />
        <span class="att-text-muted" style="font-size: var(--att-text-xs);">
          Las credenciales se almacenan cifradas en tu dispositivo. Usa «Presentar» para compartir
          vía QR, o «Escanear QR de verificador» para el flujo OID4VP completo.
        </span>
      </div>
    </div>

    <!-- ── Details modal ─────────────────────────────── -->
    <q-dialog v-model="detailsOpen">
      <q-card class="details-card" v-if="selected">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ credentialTitle(selected) }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div class="details-row">
            <div class="details-row__label">Emisor</div>
            <div class="details-row__value">
              Estación Attestto de este dispositivo
              <div class="details-row__sub">
                {{ truncateDid(selected.proof?.delegationProof?.stationDid) }}
              </div>
            </div>
          </div>

          <div class="details-row">
            <div class="details-row__label">Autoridad de los datos</div>
            <div class="details-row__value">
              {{ authorityName(selected) }}
              <div class="details-row__sub">
                {{ truncateDid(evidence(selected)?.authority) }}
              </div>
            </div>
          </div>

          <div class="details-row">
            <div class="details-row__label">Cross-check Padrón</div>
            <div class="details-row__value">
              <q-icon
                :name="evidence(selected)?.padronMatch ? 'check_circle' : 'cancel'"
                :color="evidence(selected)?.padronMatch ? 'positive' : 'negative'"
                size="16px"
              />
              <span class="q-ml-xs">
                {{ evidence(selected)?.padronMatch ? 'Coincide con Padrón Electoral' : 'No verificado contra Padrón' }}
              </span>
            </div>
          </div>

          <div class="details-row" v-if="evidence(selected)?.faceMatchScore !== undefined">
            <div class="details-row__label">Coincidencia facial</div>
            <div class="details-row__value">
              <q-icon
                :name="(evidence(selected)?.faceMatchScore ?? 0) >= 0.4 ? 'check_circle' : 'cancel'"
                :color="(evidence(selected)?.faceMatchScore ?? 0) >= 0.4 ? 'positive' : 'negative'"
                size="16px"
              />
              <span class="q-ml-xs">
                {{ (evidence(selected)?.faceMatchScore ?? 0) >= 0.4 ? 'Coincide' : 'No coincide' }}
              </span>
            </div>
          </div>

          <div class="details-row" v-if="evidence(selected)?.livenessVerified !== undefined">
            <div class="details-row__label">Prueba de vida</div>
            <div class="details-row__value">
              <q-icon
                :name="evidence(selected)?.livenessVerified ? 'check_circle' : 'cancel'"
                :color="evidence(selected)?.livenessVerified ? 'positive' : 'negative'"
                size="16px"
              />
              <span class="q-ml-xs">
                {{ evidence(selected)?.livenessVerified ? 'Verificada' : 'No verificada' }}
              </span>
            </div>
          </div>

          <div class="details-row">
            <div class="details-row__label">Firmada</div>
            <div class="details-row__value">{{ formatDateTime(selected.proof?.created || selected.issuanceDate) }}</div>
          </div>

          <div class="details-row">
            <div class="details-row__label">Anclado en</div>
            <div class="details-row__value att-text-muted">Pendiente</div>
          </div>

          <div class="details-row" v-if="trustLevel(selected)">
            <div class="details-row__label">Nivel de confianza</div>
            <div class="details-row__value">
              <q-badge :color="trustColor(trustLevel(selected))" :label="trustLevel(selected)" />
              <q-tooltip>
                A+ · Firma Digital con tarjeta inteligente<br>
                A · Cédula + Padrón + face match + liveness + smart card<br>
                B · Cédula + Padrón + face match + liveness<br>
                C · Cédula escaneada únicamente<br>
                D · Auto-declarada
              </q-tooltip>
            </div>
          </div>
        </q-card-section>

        <q-separator />

        <q-card-section class="q-pt-sm">
          <a class="advanced-toggle" @click="showRawJson = !showRawJson">
            {{ showRawJson ? 'Ocultar' : 'Ver' }} credencial técnica (avanzado)
          </a>
          <pre v-if="showRawJson" class="raw-json">{{ JSON.stringify(selected, null, 2) }}</pre>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- ── Presentation dialog ─────────────────────────── -->
    <q-dialog v-model="presentDialogOpen">
      <q-card style="min-width: 400px; max-width: 500px;">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Presentar credencial</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section class="column items-center q-pa-lg">
          <!-- Loading -->
          <div v-if="presenting" class="column items-center q-gutter-md">
            <q-spinner size="40px" color="primary" />
            <span class="text-grey">Firmando presentación...</span>
          </div>

          <!-- Error -->
          <div v-else-if="presentError" class="text-negative text-center">
            {{ presentError }}
          </div>

          <!-- QR + JSON -->
          <template v-else-if="presentVpJson">
            <img v-if="presentQrUrl" :src="presentQrUrl" alt="VP QR" style="width: 280px; height: 280px; border-radius: 8px;" />
            <p v-if="presentQrUrl" class="text-grey text-caption q-mt-sm text-center">
              El verificador escanea este QR para recibir tu presentación verificable.
            </p>
            <p v-else class="text-grey text-caption text-center">
              La credencial es muy grande para un QR. Copia el JSON.
            </p>

            <div class="row q-gutter-sm q-mt-md">
              <q-btn
                flat
                icon="content_copy"
                label="Copiar JSON"
                color="primary"
                @click="navigator.clipboard.writeText(presentVpJson); $q.notify({ type: 'positive', message: 'VP copiada', timeout: 1500, position: 'top' })"
              />
            </div>
          </template>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped lang="scss">
.credential-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.credential-card {
  border: 1px solid var(--att-border);
  border-radius: 0.875rem;
  background: var(--att-bg-surface);
  overflow: hidden;
  transition: border-color 0.15s;

  &:hover {
    border-color: var(--q-primary);
  }
}

.credential-card__header {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem 1.125rem 0.75rem;
}

.credential-card__title {
  flex: 1;
  min-width: 0;
}

.trust-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.125rem;
  font-size: var(--att-text-xs);
  color: var(--att-text-muted);
}

.trust-row__label {
  color: var(--q-positive);
  font-weight: 500;
}

.trust-blurb {
  margin-top: 0.25rem;
  font-size: 0.9rem;
  color: var(--att-text-muted);
  line-height: 1.35;
}

.credential-card__identity {
  padding: 0.5rem 1.125rem 0.875rem;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.375rem;
}

.identity-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 0.5rem;
  font-size: var(--att-text-sm);
}

.identity-label {
  color: var(--att-text-muted);
}

.identity-value {
  font-weight: 500;
  font-feature-settings: 'tnum';
}

.provenance-strip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.125rem;
  border-top: 1px solid var(--att-border);
  font-size: var(--att-text-xs);
  color: var(--att-text-muted);
}

.provenance-strip__link {
  margin-left: auto;
  color: var(--q-primary);
  cursor: pointer;
  &:hover { text-decoration: underline; }
}

.credential-card__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem;
  border-top: 1px solid var(--att-border);
}

.info-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: var(--att-bg-surface);
}

.details-card {
  width: 540px;
  max-width: 95vw;
}

.details-row {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 0.75rem;
  padding: 0.5rem 0;
  font-size: var(--att-text-sm);
  border-bottom: 1px solid var(--att-border);

  &:last-of-type { border-bottom: none; }
}

.details-row__label {
  color: var(--att-text-muted);
}

.details-row__value {
  font-weight: 500;
  word-break: break-word;
}

.details-row__sub {
  font-family: monospace;
  font-size: var(--att-text-xs);
  color: var(--att-text-muted);
  margin-top: 0.125rem;
  font-weight: normal;
}

.advanced-toggle {
  font-size: var(--att-text-xs);
  color: var(--att-text-muted);
  cursor: pointer;
  &:hover { color: var(--q-primary); text-decoration: underline; }
}

.raw-json {
  margin-top: 0.5rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: var(--att-bg-base, #0f1923);
  color: #cdd6e0;
  font-size: 0.9rem;
  max-height: 320px;
  overflow: auto;
}
</style>
