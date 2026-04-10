<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import PdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker'
import { verifyPdfSignatures, type PdfVerifyResult } from '../composables/usePdfSignatures'
import { useVaultStore } from '../stores/vault'
import { Dialog, Notify } from 'quasar'

const vault = useVaultStore()
const signing = ref(false)
// `pdfBytes` is forward-declared below; we wrap canSign in a function-ish
// computed that re-evaluates whenever the ref changes.
const canSign = computed(() => vault.identityVerified && !!pdfBytes.value)

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)([a-záéíóúñ])/g, (_, sp, ch) => sp + ch.toUpperCase())
}

/**
 * Pull display name + Attestto handle + country from any cédula credential
 * in the vault, falling back to localStorage for users who verified before
 * the vault-first migration. CR-only for now.
 */
async function loadSignerIdentity(): Promise<{ name?: string; handle?: string; country?: string }> {
  const api = (window as any).presenciaAPI
  const fromCedula = (cedula: unknown, nombre: unknown) => {
    const name = nombre ? titleCase(String(nombre).trim()) : undefined
    const clean = cedula ? String(cedula).replace(/[^0-9]/g, '') : undefined
    const handle = clean ? `cr-${clean}.attestto.id` : undefined
    const country = clean ? 'CR' : undefined
    return { name, handle, country }
  }

  // Vault first
  try {
    const contents = await api?.vault?.read?.()
    for (const c of contents?.credentials ?? []) {
      const cedula = c?.credentialSubject?.cedula ?? c?.data?.cedula
      const nombre = c?.credentialSubject?.nombre ?? c?.data?.nombre
      if (cedula || nombre) return fromCedula(cedula, nombre)
    }
  } catch { /* non-fatal */ }

  // Legacy localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith('attestto-credential-')) continue
    try {
      const c = JSON.parse(localStorage.getItem(key)!)
      const cedula = c?.credentialSubject?.cedula ?? c?.data?.cedula
      const nombre = c?.credentialSubject?.nombre ?? c?.data?.nombre
      if (cedula || nombre) return fromCedula(cedula, nombre)
    } catch { /* ignore malformed */ }
  }

  return {}
}

/**
 * Map an Attestto signature (or vault state) to its honest legal level.
 *
 * Hierarchy (CR Ley 8454 / eIDAS):
 *   - Nivel B          — vault-only, no public DID. did:key, requires trusting Attestto.
 *                        AdES technical / SES legal CR. Today's default.
 *   - Nivel B+         — DID is publicly resolvable (did:web). Anyone can verify the
 *                        public key independently of Attestto. Same legal class but
 *                        materially stronger evidentiary value.
 *   - Nivel A+ DEMO    — Firma Digital mock wizard, never legally binding.
 *   - Nivel A+         — real BCCR PKCS#11 card via ATT-340. QES / Firma Digital
 *                        Certificada. Full Ley 8454 art. 9 presumption.
 *
 * The detection is intentionally derived from the issuer DID method so it
 * keeps working when the signer wasn't us (we're verifying, not just signing).
 */
interface LevelInfo {
  label: string
  short: string
  tone: 'b' | 'b-plus' | 'a-plus-demo' | 'a-plus'
}
function resolveSignatureLevel(sig: { issuer: string; level: string; mock: boolean }): LevelInfo {
  if (sig.mock || sig.level === 'firma-digital-mocked') {
    return { label: 'Nivel A+ (DEMO)', short: 'A+ DEMO', tone: 'a-plus-demo' }
  }
  // Real PKCS#11 path will land here when ATT-340 ships and writes a new level.
  if (sig.level === 'firma-digital-pkcs11') {
    return { label: 'Nivel A+ · Firma Digital Certificada', short: 'A+', tone: 'a-plus' }
  }
  // did:web (HTTPS-resolvable) and did:sns (Solana-anchored) are both
  // publicly resolvable DID methods → same Nivel B+ legal class. See PDF
  // Module Confluence page for the did:web vs did:sns evidentiary trade-off.
  if (sig.issuer.startsWith('did:web:') || sig.issuer.startsWith('did:sns:')) {
    return { label: 'Nivel B+ · DID público verificable', short: 'B+', tone: 'b-plus' }
  }
  return { label: 'Nivel B · auto-atestada', short: 'B', tone: 'b' }
}

async function startSigning() {
  if (!pdfBytes.value || signing.value) return
  const api = (window as any).presenciaAPI
  if (!api?.pdf?.signAttestto) {
    Notify.create({ type: 'negative', message: 'API de firma no disponible' })
    return
  }

  // For the pre-sign confirm dialog. Real signing path uses the issuer DID
  // method to determine the level; here we only know vault state, so we
  // approximate (vault DIDs today are did:key → Nivel B).
  const levelLabel = vault.firmaDigitalLevel === 'firma-digital-mocked'
    ? 'Nivel A+ (DEMO)'
    : (vault.did?.startsWith('did:web:') || vault.did?.startsWith('did:sns:')
        ? 'Nivel B+ · DID público'
        : 'Nivel B · auto-atestada')

  const lockedNote = vault.isUnlocked
    ? ''
    : '<br><br><span style="color:#fbbf24">Tu bóveda está bloqueada. Te pediremos Touch ID para desbloquearla.</span>'

  // Heads-up when the PDF already carries PAdES signatures (BCCR / Firma
  // Digital). Our pdf-lib path rewrites the file, which invalidates any
  // pre-existing PAdES byte-range hashes. ATT-340 (muhammara incremental
  // updates) is the permanent fix.
  const existingPades = verification.value?.signatures?.length ?? 0
  const padesWarning = existingPades > 0
    ? `<br><br><div style="background:rgba(180,83,9,0.15);border:1px solid #b45309;border-radius:6px;padding:8px 10px;color:#fbbf24;font-size:0.85rem;line-height:1.4"><b>⚠ ${existingPades} firma${existingPades > 1 ? 's' : ''} PAdES existente${existingPades > 1 ? 's' : ''}.</b><br>Firmar con Attestto reescribe el PDF y va a invalidar la${existingPades > 1 ? 's' : ''} firma${existingPades > 1 ? 's' : ''} previa${existingPades > 1 ? 's' : ''}. La firma Attestto será válida; las anteriores aparecerán como TAMPERED.</div>`
    : ''

  Dialog.create({
    title: 'Firmar documento',
    message: `Vas a firmar <b>${fileName.value}</b> con ${levelLabel}.<br><br>Elegí qué pasa con el documento después:${lockedNote}${padesWarning}`,
    html: true,
    options: {
      type: 'radio',
      model: 'final',
      items: [
        {
          label: 'Documento final — bloqueado, sin más firmas ni ediciones',
          value: 'final',
          color: 'blue-6',
        },
        {
          label: 'Editable — permite que otros firmen o agreguen contenido',
          value: 'open',
          color: 'blue-6',
        },
      ],
    },
    ok: { label: 'Firmar', color: 'blue-6', textColor: 'white', unelevated: true },
    cancel: { label: 'Cancelar', flat: true, color: 'grey-5' },
    persistent: true,
  }).onOk(async (mode: 'final' | 'open') => {
    signing.value = true
    try {
      // Unlock the vault if needed — main-process sign() refuses on locked
      // vault. Touch ID prompt happens inside vault.unlock().
      if (!vault.isUnlocked) {
        const ok = await vault.unlock()
        if (!ok) {
          Notify.create({
            type: 'warning',
            message: 'Necesitás desbloquear la bóveda para firmar',
            position: 'top',
          })
          signing.value = false
          return
        }
      }

      // Now that the vault is unlocked, fetch the human identity.
      const { name: signerName, handle: signerHandle, country: signerCountry } = await loadSignerIdentity()

      const result = await api.pdf.signAttestto({
        pdfBytes: pdfBytes.value!,
        fileName: fileName.value,
        signerName,
        signerHandle,
        signerCountry,
        level: vault.firmaDigitalLevel,
        mode,
        reason: 'Firmado con Attestto',
        location: 'Costa Rica',
      })
      const signedBytes: Uint8Array = result.pdfBytes instanceof Uint8Array
        ? result.pdfBytes
        : new Uint8Array(Object.values(result.pdfBytes as Record<string, number>))

      // Save dialog
      const defaultName = fileName.value.replace(/\.pdf$/i, '') + ' (firmado).pdf'
      const saved = await api.pdf.save({ bytes: signedBytes, defaultFileName: defaultName })
      if (saved.cancelled) {
        signing.value = false
        return
      }

      // Reload viewer with the signed bytes so the user sees their stamp
      // and the signatures sidebar picks up the new Attestto signature.
      fileName.value = defaultName
      await loadDocument(signedBytes)

      Notify.create({
        type: 'positive',
        message: 'Documento firmado',
        caption: `Guardado en ${saved.path}`,
        position: 'top',
        timeout: 5000,
        icon: 'verified',
      })

      // ATT-355: when the source PDF already had a signature (e.g.
      // Firma Digital countersigning) we took the incremental path
      // and suppressed the visible stamp to preserve the prior
      // /ByteRange digest. Surface that to the user so they don't
      // think the stamp got dropped silently.
      if (result.stampSuppressed) {
        Notify.create({
          type: 'info',
          message: 'Sello visual omitido',
          caption: 'El documento ya tenía una firma previa. Se preservó intacta y la firma Attestto se anexó como una nueva revisión sin sello visible.',
          position: 'top',
          timeout: 8000,
          icon: 'info',
          multiLine: true,
        })
      }
    } catch (err) {
      console.error('[pdf-sign] failed:', err)
      Notify.create({
        type: 'negative',
        message: 'No se pudo firmar el documento',
        caption: err instanceof Error ? err.message : String(err),
        position: 'top',
      })
    } finally {
      signing.value = false
    }
  })
}

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker()

const route = useRoute()
const router = useRouter()

const pdfBytes = ref<Uint8Array | null>(null)
const fileName = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const zoom = ref(1)
const isDragging = ref(false)
const pageCount = ref(0)
const pdfTitle = ref('')
const pdfAuthor = ref('')
const pdfHasJS = ref(false)
const pdfHasAttachments = ref(false)
const pdfHasForms = ref(false)
const pdfEditable = ref(true)
const pdfEncrypted = ref(false)
const rendering = ref(false)
const pagesContainerRef = ref<HTMLDivElement | null>(null)
const verification = ref<PdfVerifyResult | null>(null)
const verifying = ref(false)
const sidebarExpanded = ref(false)
const signaturesExpanded = ref(false)
function toggleSignaturesPanel(): void {
  signaturesExpanded.value = !signaturesExpanded.value
  sidebarExpanded.value = signaturesExpanded.value
}
function isExpired(validTo?: string | Date | null): boolean {
  if (!validTo) return false
  return new Date(validTo).getTime() < Date.now()
}
const showAttesttoTech = ref(false)
const showAttesttoChain = ref(false)

const COUNTRY_FLAGS: Record<string, string> = {
  CR: '\u{1F1E8}\u{1F1F7}', MX: '\u{1F1F2}\u{1F1FD}', CO: '\u{1F1E8}\u{1F1F4}',
  BR: '\u{1F1E7}\u{1F1F7}', CL: '\u{1F1E8}\u{1F1F1}', PE: '\u{1F1F5}\u{1F1EA}',
  AR: '\u{1F1E6}\u{1F1F7}', EC: '\u{1F1EA}\u{1F1E8}', UY: '\u{1F1FA}\u{1F1FE}',
  US: '\u{1F1FA}\u{1F1F8}', ES: '\u{1F1EA}\u{1F1F8}', PA: '\u{1F1F5}\u{1F1E6}',
}

function getFlag(country: string | undefined): string {
  return country ? COUNTRY_FLAGS[country] || '' : ''
}

const scrollContainerRef = ref<HTMLDivElement | null>(null)

let pdfDoc: any = null

async function autoFitZoom() {
  if (!pdfDoc || !scrollContainerRef.value) return
  const page = await pdfDoc.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const containerWidth = scrollContainerRef.value.clientWidth - 48 // padding
  const fitZoom = containerWidth / viewport.width
  zoom.value = Math.round(fitZoom * 100) / 100
}

async function loadDocument(bytes: Uint8Array) {
  loading.value = true
  error.value = null
  try {
    const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() })
    pdfDoc = await loadingTask.promise
    pageCount.value = pdfDoc.numPages
    const meta = await pdfDoc.getMetadata()
    pdfTitle.value = meta?.info?.Title || ''
    pdfAuthor.value = meta?.info?.Author || ''
    pdfEncrypted.value = !!meta?.info?.IsLinearized === false && !!meta?.info?.Encrypted
    try {
      const js = await pdfDoc.getJSActions?.()
      pdfHasJS.value = !!js && Object.keys(js).length > 0
    } catch { pdfHasJS.value = false }
    try {
      const atts = await pdfDoc.getAttachments?.()
      pdfHasAttachments.value = !!atts && Object.keys(atts).length > 0
    } catch { pdfHasAttachments.value = false }
    try {
      const fields = await pdfDoc.getFieldObjects?.()
      pdfHasForms.value = !!fields && Object.keys(fields).length > 0
    } catch { pdfHasForms.value = false }
    try {
      const perms = await pdfDoc.getPermissions?.()
      // perms is null when no restrictions (fully editable). Array when restricted.
      pdfEditable.value = perms === null
    } catch { pdfEditable.value = true }
    pdfBytes.value = bytes
    loading.value = false      // must be false BEFORE render so the template mounts pagesContainerRef
    await nextTick()
    await autoFitZoom()
    await renderAllPages()
    // Verify signatures in background
    verifying.value = true
    verification.value = null
    // Pass a fresh copy — PDF.js transfers buffers to its worker and can leave
    // the original Uint8Array detached, which would break the latin1 decode
    // inside extractSignatures().
    verifyPdfSignatures(bytes.slice(), fileName.value).then((result) => {
      verification.value = result
      verifying.value = false
    }).catch((err) => {
      console.error('[pdf-verify] failed:', err)
      verifying.value = false
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al abrir el PDF'
    pdfDoc = null
    loading.value = false
  }
}

async function renderAllPages() {
  if (!pdfDoc || !pagesContainerRef.value) return
  rendering.value = true

  // Clear previous canvases
  pagesContainerRef.value.innerHTML = ''

  try {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const viewport = page.getViewport({ scale: zoom.value * 1.5 })

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${Math.floor(viewport.width / 1.5)}px`
      canvas.style.height = `${Math.floor(viewport.height / 1.5)}px`
      canvas.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)'
      canvas.style.borderRadius = '2px'
      canvas.style.display = 'block'

      const ctx = canvas.getContext('2d')
      if (ctx) {
        // Render to offscreen, then append — prevents blank flash
        await page.render({ canvasContext: ctx, viewport }).promise
      }

      pagesContainerRef.value!.appendChild(canvas)
    }
  } finally {
    rendering.value = false
  }
}

function zoomIn() { zoom.value = Math.min(zoom.value + 0.25, 3) }
function zoomOut() { zoom.value = Math.max(zoom.value - 0.25, 0.5) }
function resetZoom() { zoom.value = 1 }

watch(() => zoom.value, () => { if (pdfDoc) renderAllPages() })

async function openFromPath(filePath: string) {
  loading.value = true
  error.value = null
  try {
    const api = (window as any).presenciaAPI
    const bytes = api?.readFile(filePath)
    if (!bytes) throw new Error('No se pudo leer el archivo')
    fileName.value = api?.basename(filePath) || filePath.split('/').pop() || 'Documento'
    await loadDocument(bytes)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al abrir'
    loading.value = false
  }
}

async function openFromFile(file: File) {
  fileName.value = file.name
  const buffer = await file.arrayBuffer()
  await loadDocument(new Uint8Array(buffer))
}

async function pickFile() {
  const api = (window as any).presenciaAPI
  if (api?.pickPdfFile) {
    const filePath = await api.pickPdfFile()
    if (filePath) openFromPath(filePath)
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.pdf'
  input.onchange = () => { const f = input.files?.[0]; if (f) openFromFile(f) }
  input.click()
}

function onDragOver(e: DragEvent) { e.preventDefault(); isDragging.value = true }
function onDragLeave() { isDragging.value = false }
function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file && (file.type === 'application/pdf' || file.name.endsWith('.pdf'))) openFromFile(file)
}

function onKeydown(e: KeyboardEvent) {
  if ((e.key === '+' || e.key === '=') && e.metaKey) { e.preventDefault(); zoomIn() }
  if (e.key === '-' && e.metaKey) { e.preventDefault(); zoomOut() }
  if (e.key === '0' && e.metaKey) { e.preventDefault(); resetZoom() }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  const filePath = route.query.file as string
  if (filePath) openFromPath(filePath)
  const api = (window as any).presenciaAPI
  if (api?.onOpenPdf) api.onOpenPdf((path: string) => openFromPath(path))
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <q-page
    class="pdf-page"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Empty state -->
    <div v-if="!pdfBytes && !loading && !error" class="pdf-empty" @click="pickFile">
      <div class="pdf-dropzone" :class="{ 'pdf-dropzone--active': isDragging }">
        <q-icon name="picture_as_pdf" size="72px" :color="isDragging ? 'primary' : 'grey-7'" />
        <div class="text-h5 q-mt-lg" style="color: rgba(255,255,255,0.85)">
          {{ isDragging ? 'Soltar aqui' : 'Visor de PDF' }}
        </div>
        <div class="text-body2 q-mt-sm" style="color: rgba(255,255,255,0.4); max-width: 320px">
          Arrastra un archivo PDF aqui o selecciona uno desde tu dispositivo
        </div>
        <q-btn unelevated color="primary" label="Seleccionar archivo" icon="folder_open" class="q-mt-xl" @click.stop="pickFile" />
        <div class="text-caption q-mt-lg" style="color: rgba(255,255,255,0.2)">
          Tu documento no sale de tu dispositivo
        </div>
      </div>
    </div>

    <!-- Loading document -->
    <div v-else-if="loading" class="pdf-empty">
      <q-spinner-orbit size="48px" color="primary" />
      <div class="text-body2 q-mt-md" style="color: rgba(255,255,255,0.5)">Cargando documento...</div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="pdf-empty">
      <q-icon name="error_outline" size="56px" color="negative" />
      <div class="text-body1 q-mt-md" style="color: rgba(255,255,255,0.7)">{{ error }}</div>
      <q-btn flat color="primary" label="Intentar de nuevo" icon="refresh" class="q-mt-md" @click="pickFile" />
    </div>

    <!-- Drag overlay on loaded PDF -->
    <div v-if="isDragging && pdfBytes" class="pdf-drag-overlay">
      <q-icon name="file_upload" size="56px" color="primary" />
      <div class="text-h6 q-mt-sm" style="color: rgba(255,255,255,0.85)">Soltar para reemplazar</div>
    </div>

    <!-- PDF loaded -->
    <template v-if="pdfBytes && !loading && !error">
      <!-- Toolbar -->
      <div class="pdf-toolbar">
        <div class="pdf-toolbar__left">
          <q-btn flat dense round icon="arrow_back" size="sm" @click="router.push('/unlock')" />
          <q-icon name="picture_as_pdf" size="20px" color="negative" />
          <span class="pdf-toolbar__name">{{ fileName }}</span>
          <q-chip dense size="sm" color="grey-9" text-color="grey-5">
            {{ pageCount }} {{ pageCount === 1 ? 'pagina' : 'paginas' }}
          </q-chip>
        </div>
        <div class="pdf-toolbar__center">
          <q-btn flat dense round icon="remove" size="sm" @click="zoomOut" />
          <span class="pdf-toolbar__zoom" @click="resetZoom">{{ Math.round(zoom * 100) }}%</span>
          <q-btn flat dense round icon="add" size="sm" @click="zoomIn" />
        </div>
        <div class="pdf-toolbar__right">
          <q-btn
            v-if="canSign"
            unelevated
            color="blue-6"
            text-color="white"
            icon="draw"
            label="Firmar"
            size="md"
            :loading="signing"
            class="pdf-toolbar__sign"
            @click="startSigning"
          >
            <q-tooltip>Firmar este documento</q-tooltip>
          </q-btn>
          <q-btn
            v-else-if="vault.identityVerified === false && pdfBytes"
            flat
            color="grey-5"
            icon="lock"
            label="Firmar"
            size="md"
            class="pdf-toolbar__sign"
            @click="router.push('/cedula')"
          >
            <q-tooltip>Verificá tu identidad para firmar</q-tooltip>
          </q-btn>
          <q-btn flat round icon="folder_open" size="md" @click="pickFile">
            <q-tooltip>Abrir otro PDF</q-tooltip>
          </q-btn>
        </div>
      </div>

      <!-- Scrollable pages + sidebar -->
      <div class="pdf-canvas-area" :style="sidebarExpanded ? '--sidebar-width: 420px' : ''">
        <div ref="scrollContainerRef" class="pdf-canvas-scroll">
          <!-- Rendering spinner -->
          <div v-if="rendering" class="pdf-rendering-overlay">
            <q-spinner-orbit size="40px" color="primary" />
          </div>
          <!-- All pages rendered here -->
          <div ref="pagesContainerRef" class="pdf-pages" />
        </div>

        <!-- Sidebar -->
        <div class="pdf-sidebar" :class="{ 'pdf-sidebar--expanded': sidebarExpanded }">
          <div class="pdf-sidebar__section">
            <div class="pdf-sidebar__label">Documento</div>
            <div class="pdf-sidebar__value">{{ fileName }}</div>
          </div>
          <div v-if="pdfTitle" class="pdf-sidebar__section">
            <div class="pdf-sidebar__label">Titulo</div>
            <div class="pdf-sidebar__value">{{ pdfTitle }}</div>
          </div>
          <div v-if="pdfAuthor" class="pdf-sidebar__section">
            <div class="pdf-sidebar__label">Autor</div>
            <div class="pdf-sidebar__value">{{ pdfAuthor }}</div>
          </div>
          <div class="pdf-sidebar__section">
            <div class="pdf-sidebar__label">Paginas</div>
            <div class="pdf-sidebar__value">{{ pageCount }}</div>
          </div>
          <q-separator dark class="q-my-md" />

          <!-- Signature verification -->
          <div class="pdf-sidebar__section">
            <div class="pdf-sidebar__label">Firmas digitales</div>

            <!-- Verifying -->
            <div v-if="verifying" style="display: flex; align-items: center; gap: 8px; margin-top: 0.5rem;">
              <q-spinner-dots size="16px" color="primary" />
              <span class="pdf-sidebar__value">Verificando...</span>
            </div>

            <!-- No signatures -->
            <div v-else-if="verification && verification.signatures.length === 0" class="pdf-sidebar__value" style="color: rgba(255,255,255,0.3)">
              Sin firmas digitales
            </div>

            <!-- Signatures found -->
            <template v-else-if="verification && verification.signatures.length > 0">
              <!-- Overall status — clickable to expand sidebar + details -->
              <button
                type="button"
                class="sig-status sig-status--valid sig-status--clickable"
                @click="toggleSignaturesPanel"
              >
                <q-icon name="verified" size="20px" />
                <span>{{ verification.signatures.length }} firma{{ verification.signatures.length > 1 ? 's' : '' }} detectada{{ verification.signatures.length > 1 ? 's' : '' }}</span>
                <q-icon :name="signaturesExpanded ? 'chevron_right' : 'chevron_left'" size="18px" class="q-ml-auto" />
              </button>

              <!-- Each signature -->
              <div v-for="(sig, idx) in verification.signatures" :key="idx" class="sig-card">
                <div class="sig-card__header">
                  <q-icon
                    :name="sig.validation?.trusted
                      ? 'verified'
                      : sig.validation?.chain.status === 'valid'
                        ? 'gpp_maybe'
                        : sig.validation?.chain.status === 'expired'
                          ? 'schedule'
                          : sig.level === 'parsed'
                            ? 'check_circle'
                            : 'info'"
                    :color="sig.validation?.trusted
                      ? 'positive'
                      : sig.validation?.chain.status === 'expired'
                        ? 'warning'
                        : sig.validation?.chain.status === 'valid'
                          ? 'warning'
                          : sig.level === 'parsed'
                            ? 'positive'
                            : 'warning'"
                    size="16px"
                  />
                  <span class="sig-card__name">{{ sig.name }}</span>
                </div>

                <!-- Expiry / validity highlight — always visible -->
                <div
                  v-if="sig.certChain?.signer?.validTo"
                  class="sig-card__validity"
                  :class="{ 'sig-card__validity--expired': isExpired(sig.certChain.signer.validTo) }"
                >
                  <q-icon
                    :name="isExpired(sig.certChain.signer.validTo) ? 'warning' : 'schedule'"
                    size="14px"
                  />
                  <span>
                    {{ isExpired(sig.certChain.signer.validTo) ? 'Certificado expirado' : 'Certificado vigente' }}
                    · vence {{ new Date(sig.certChain.signer.validTo).toLocaleDateString() }}
                  </span>
                </div>

                <!-- Collapsible details — only when sidebar expanded -->
                <template v-if="signaturesExpanded">
                  <div v-if="sig.validation" class="sig-card__detail">
                    <span class="sig-card__label">Confianza</span>
                    <span>{{ sig.validation.summary }}</span>
                  </div>

                  <div v-if="sig.subFilter" class="sig-card__detail">
                    <span class="sig-card__label">Tipo</span>
                    <span>{{ sig.subFilter }}</span>
                  </div>

                  <div v-if="sig.signDate" class="sig-card__detail">
                    <span class="sig-card__label">Fecha</span>
                    <span>{{ new Date(sig.signDate).toLocaleDateString() }}</span>
                  </div>

                  <div v-if="sig.certChain?.pki" class="sig-card__detail">
                    <span class="sig-card__label">PKI</span>
                    <span>{{ getFlag(sig.certChain.pki.country) }} {{ sig.certChain.pki.name }}</span>
                  </div>

                  <div v-if="sig.certChain?.pki?.certificateType" class="sig-card__detail">
                    <span class="sig-card__label">Tipo cert</span>
                    <span>{{ sig.certChain.pki.certificateType }}</span>
                  </div>

                  <div v-if="sig.certChain?.signer?.issuerCommonName" class="sig-card__detail">
                    <span class="sig-card__label">Emisor</span>
                    <span>{{ sig.certChain.signer.issuerCommonName }}</span>
                  </div>

                  <div v-if="sig.certChain?.signer?.validFrom" class="sig-card__detail">
                    <span class="sig-card__label">Valido</span>
                    <span>{{ new Date(sig.certChain.signer.validFrom).toLocaleDateString() }} — {{ new Date(sig.certChain.signer.validTo!).toLocaleDateString() }}</span>
                  </div>

                  <!-- Certificate chain -->
                  <div v-if="sig.certChain && sig.certChain.chain.length > 0" class="sig-chain">
                    <div v-for="(cert, ci) in sig.certChain.chain" :key="ci" class="sig-chain__cert">
                      <q-icon
                        :name="cert.role === 'root' ? 'apartment' : cert.role === 'intermediate' ? 'link' : 'draw'"
                        size="11px"
                        :color="cert.role === 'root' ? 'grey-5' : cert.role === 'intermediate' ? 'grey-6' : 'primary'"
                      />
                      <span>{{ cert.commonName }}</span>
                    </div>
                  </div>
                </template>

                <div class="sig-card__badges">
                  <q-badge
                    :color="sig.level === 'tampered'
                      ? 'warning'
                      : sig.level === 'parsed'
                        ? 'positive'
                        : sig.level === 'detected'
                          ? 'warning'
                          : 'primary'"
                    :text-color="sig.level === 'tampered' ? 'white' : undefined"
                    :label="sig.level === 'tampered'
                      ? '⚠ TAMPERED'
                      : sig.level === 'parsed'
                        ? 'PARSED'
                        : sig.level === 'detected'
                          ? 'DETECTED'
                          : sig.level.toUpperCase()"
                  />
                  <q-badge v-if="sig.certChain?.pki" color="info" :label="getFlag(sig.certChain.pki.country) + ' ' + sig.certChain.pki.country" />
                  <q-badge :color="pdfEditable ? 'amber-8' : 'blue-grey-7'" :label="pdfEditable ? 'EDITABLE' : 'BLOQUEADO'" />
                  <q-badge v-if="pdfHasJS" color="warning" text-color="white" label="⚠ JAVASCRIPT" />
                  <q-badge v-if="pdfHasForms" color="blue-grey-6" label="FORMULARIO" />
                  <q-badge v-if="pdfHasAttachments" color="blue-grey-6" label="ADJUNTOS" />
                  <q-badge v-if="pdfEncrypted" color="blue-grey-7" label="CIFRADO" />
                  <q-badge :color="canSign ? 'blue-6' : 'blue-grey-7'" :label="canSign ? 'FIRMABLE' : 'NO FIRMABLE'" />
                  <q-badge :color="(verification.attestto as any)?.signature?.anchor ? 'positive' : 'blue-grey-7'" :label="(verification.attestto as any)?.signature?.anchor ? '⚓ ANCLADO' : 'NO ANCLADO'" />
                </div>
              </div>
            </template>

            <!-- Not yet verified -->
            <div v-else class="pdf-sidebar__value" style="color: rgba(255,255,255,0.3)">
              —
            </div>
          </div>

          <!-- Attestto self-attested signature (parallel to PAdES) -->
          <template v-if="verification?.attestto">
            <q-separator dark class="q-my-md" />
            <div class="pdf-sidebar__section">
              <div class="pdf-sidebar__label">Firma Attestto</div>

              <button
                type="button"
                class="sig-status sig-status--valid sig-status--clickable"
                @click="toggleSignaturesPanel"
              >
                <q-icon :name="verification.attestto.valid ? 'verified' : 'gpp_bad'" size="20px" />
                <span>Firma auto-atestada</span>
                <q-icon :name="signaturesExpanded ? 'chevron_right' : 'chevron_left'" size="18px" class="q-ml-auto" />
              </button>

              <div class="sig-card sig-card--attestto">
                <div class="sig-card__header">
                  <q-icon
                    :name="verification.attestto.valid ? 'verified' : 'gpp_bad'"
                    :color="verification.attestto.valid ? 'positive' : 'negative'"
                    size="16px"
                  />
                  <span class="sig-card__name">
                    {{ verification.attestto.signature.issuerName
                       || verification.attestto.signature.issuerHandle
                       || 'Firma auto-atestada' }}
                  </span>
                </div>

                <!-- Validity highlight — mirrors PAdES card -->
                <div class="sig-card__validity">
                  <q-icon name="schedule" size="14px" />
                  <span>
                    {{ resolveSignatureLevel(verification.attestto.signature).label }}
                    · firmada {{ new Date(verification.attestto.signature.signedAt).toLocaleDateString() }}
                  </span>
                </div>

                <div
                  v-if="verification.attestto.signature.issuerHandle"
                  class="sig-card__handle"
                >
                  {{ verification.attestto.signature.issuerHandle }}
                </div>

                <template v-if="signaturesExpanded">
                  <div class="sig-card__detail">
                    <span class="sig-card__label">Tipo</span>
                    <span>VC · Ed25519Signature2020</span>
                  </div>
                  <div class="sig-card__detail">
                    <span class="sig-card__label">Fecha</span>
                    <span>{{ new Date(verification.attestto.signature.signedAt).toLocaleString() }}</span>
                  </div>
                  <div class="sig-card__detail">
                    <span class="sig-card__label">PKI</span>
                    <span>{{ getFlag(verification.attestto.signature.country || 'CR') }} Attestto · KYC Padrón</span>
                  </div>
                  <div class="sig-card__detail">
                    <span class="sig-card__label">Tipo cert</span>
                    <span>{{ resolveSignatureLevel(verification.attestto.signature).label }}</span>
                  </div>
                  <div class="sig-card__detail">
                    <span class="sig-card__label">Emisor</span>
                    <span>Bóveda local · llave Ed25519</span>
                  </div>
                  <div class="sig-card__detail">
                    <span class="sig-card__label">Estado</span>
                    <span>
                      {{ verification.attestto.signature.mode === 'final'
                         ? 'Documento final · bloqueado'
                         : 'Editable · admite más firmas' }}
                    </span>
                  </div>
                  <div v-if="!verification.attestto.signatureValid" class="sig-card__detail" style="color: #ef4444;">
                    <span class="sig-card__label">Error</span>
                    <span>{{ verification.attestto.reason || 'firma inválida' }}</span>
                  </div>

                  <div class="sig-chain">
                  <div class="sig-chain__cert">
                    <q-icon name="draw" size="12px" color="primary" />
                    <span>
                      {{ verification.attestto.signature.issuerName
                         || verification.attestto.signature.issuerHandle
                         || 'Firmante' }}
                      <span class="att-text-muted" style="font-size: 0.9rem;">
                        — llave Ed25519 en bóveda
                      </span>
                    </span>
                  </div>
                  <div class="sig-chain__cert">
                    <q-icon name="badge" size="12px" color="grey-6" />
                    <span>
                      KYC verificado
                      <span class="att-text-muted" style="font-size: 0.9rem;">
                        — Padrón Electoral · Cédula
                      </span>
                    </span>
                  </div>
                  <div class="sig-chain__cert">
                    <q-icon name="apartment" size="12px" color="grey-5" />
                    <span>
                      Tribunal Supremo de Elecciones
                      <span class="att-text-muted" style="font-size: 0.9rem;">
                        — fuente de verdad CR
                      </span>
                    </span>
                  </div>
                  <div
                    v-if="verification.attestto.signature.mock"
                    class="sig-chain__note"
                  >
                    ⚠ Nivel A+ DEMO: la cadena BCCR/SINPE no es real. ATT-340
                    integra Firma Digital con tarjeta y PKCS#11.
                  </div>
                </div>
                  <div class="sig-card__detail">
                    <span class="sig-card__label">DID</span>
                    <span class="att-text-mono" style="font-size: 0.85rem; word-break: break-all;">
                      {{ verification.attestto.signature.issuer }}
                    </span>
                  </div>
                  <div class="sig-card__detail">
                    <span class="sig-card__label">Hash doc.</span>
                    <span class="att-text-mono" style="font-size: 0.85rem; word-break: break-all;">
                      {{ verification.attestto.signature.documentHash }}
                    </span>
                  </div>
                </template>

                <div class="sig-card__badges">
                  <q-badge
                    :color="verification.attestto.valid ? 'positive' : 'negative'"
                    :label="verification.attestto.valid ? 'VERIFIED' : 'INVALID'"
                  />
                  <q-badge color="blue-6" text-color="white" label="ATTESTTO" />
                  <q-badge
                    v-if="verification.attestto.signature.country
                      || verification.attestto.signature.issuerHandle?.startsWith('cr-')"
                    color="info"
                    :label="getFlag(verification.attestto.signature.country || 'CR')
                      + ' ' + (verification.attestto.signature.country || 'CR')"
                  />
                  <q-badge
                    v-if="verification.attestto.signature.mode === 'final'"
                    color="grey-7"
                    label="FINAL"
                  />
                  <q-badge
                    v-else
                    color="info"
                    label="EDITABLE"
                  />
                  <q-badge
                    v-if="verification.attestto.signature.mock"
                    color="orange"
                    label="DEMO"
                  />
                  <q-badge :color="canSign ? 'blue-6' : 'blue-grey-7'" :label="canSign ? 'FIRMABLE' : 'NO FIRMABLE'" />
                  <q-badge :color="(verification.attestto as any)?.signature?.anchor ? 'positive' : 'blue-grey-7'" :label="(verification.attestto as any)?.signature?.anchor ? '⚓ ANCLADO' : 'NO ANCLADO'" />
                </div>
              </div>
            </div>
          </template>
          <div style="flex: 1" />
          <div class="pdf-sidebar__footer">
            <div class="text-caption" style="color: rgba(255,255,255,0.2)">
              Procesado localmente. Nada sale de tu dispositivo.
            </div>
          </div>
        </div>
      </div>
    </template>
  </q-page>
</template>

<style scoped lang="scss">
.pdf-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--q-dark-page, #020617);
  position: relative;
  overflow: hidden;
}

.pdf-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.pdf-dropzone {
  text-align: center;
  padding: 4rem 3rem;
  border: 2px dashed rgba(255, 255, 255, 0.08);
  border-radius: 1.5rem;
  transition: all 0.25s;
}

.pdf-dropzone:hover,
.pdf-dropzone--active {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.03);
}

.pdf-drag-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.92);
  z-index: 20;
  border: 2px dashed rgba(99, 102, 241, 0.5);
}

.pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  gap: 1rem;
}

.pdf-toolbar__left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.pdf-toolbar__name {
  font-size: 0.875rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.pdf-toolbar__center {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.pdf-toolbar__zoom {
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.4);
  min-width: 2.5rem;
  text-align: center;
  cursor: pointer;
  &:hover { color: rgba(255, 255, 255, 0.7); }
}

.pdf-toolbar__sign {
  font-weight: 700;
  margin-right: 0.625rem;
  border-radius: 0.625rem;
  padding: 0.375rem 1rem;
  font-size: 0.875rem;
  letter-spacing: 0.02em;
}

.pdf-toolbar__right {
  display: flex;
  align-items: center;
}

.pdf-canvas-area {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr var(--sidebar-width, 280px);
  overflow: hidden;
  min-height: 0;
  transition: grid-template-columns 0.3s ease;
}

.pdf-canvas-scroll {
  overflow: auto;
  position: relative;
  background: var(--q-dark, #0f172a);
}

.pdf-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
}

.pdf-rendering-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.7);
  z-index: 5;
}

.pdf-sidebar {
  display: flex;
  flex-direction: column;
  padding: 1.25rem;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  overflow-y: auto;
  transition: width 0.3s ease;
}

.pdf-sidebar--expanded {
  --sidebar-width: 420px;
}

.pdf-sidebar__section { margin-bottom: 1rem; }

.pdf-sidebar__label {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #cbd5e1;
  margin-bottom: 0.3rem;
}

.pdf-sidebar__value {
  font-size: var(--att-text-md);
  color: #f1f5f9;
  word-break: break-word;
}

.sig-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0.6rem 0.85rem;
  border-radius: 0.55rem;
  font-size: var(--att-text-md);
  font-weight: 700;
  margin-top: 0.5rem;
  margin-bottom: 0.75rem;
  width: 100%;
}

.sig-status--clickable {
  cursor: pointer;
  border: 1px solid rgba(16, 185, 129, 0.35);
  text-align: left;
  transition: background 0.15s ease;
  &:hover { background: rgba(16, 185, 129, 0.18); }
}

.sig-status--valid {
  background: rgba(16, 185, 129, 0.14);
  color: #d1fae5;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.sig-status--invalid {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.sig-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
}

.sig-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 0.5rem;
}

.sig-card__name {
  font-size: var(--att-text-md);
  font-weight: 700;
  color: #f8fafc;
}

.sig-card__detail {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  color: #e2e8f0;
  margin-bottom: 0.35rem;
}

.sig-card__label {
  color: #94a3b8;
  flex-shrink: 0;
  margin-right: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.78rem;
}

.sig-card__validity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0.4rem 0.6rem;
  margin: 0.4rem 0 0.5rem;
  border-radius: 0.4rem;
  font-size: 0.88rem;
  font-weight: 600;
  background: rgba(16, 185, 129, 0.1);
  color: #d1fae5;
  border: 1px solid rgba(16, 185, 129, 0.25);

  &--expired {
    background: rgba(245, 158, 11, 0.12);
    color: #fde68a;
    border-color: rgba(245, 158, 11, 0.4);
  }
}

.sig-card__handle {
  font-family: ui-monospace, monospace;
  font-size: 0.88rem;
  color: var(--q-primary, #22d3a8);
  margin: -0.25rem 0 0.5rem 0;
  padding-left: 24px;
  word-break: break-all;
}

.sig-card__tech-toggle {
  display: block;
  margin: 0.4rem 0 0.2rem;
  font-size: 0.85rem;
  color: #cbd5e1;
  cursor: pointer;
  user-select: none;
  &:hover { color: var(--q-primary, #22d3a8); }
}

.sig-chain__note {
  margin-top: 0.5rem;
  padding: 0.4rem 0.55rem;
  background: rgba(245, 158, 11, 0.08);
  border: 1px dashed rgba(245, 158, 11, 0.4);
  border-radius: 0.4rem;
  color: #fbbf24;
  font-size: 0.9rem;
  line-height: 1.35;
}

.sig-chain {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 0.375rem;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.sig-chain__cert {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #cbd5e1;
  padding: 2px 0;
}

.sig-card__badges {
  display: flex;
  gap: 4px;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.pdf-sidebar__footer {
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

@media (max-width: 900px) {
  .pdf-canvas-area { grid-template-columns: 1fr; }
  .pdf-sidebar { display: none; }
}
</style>
