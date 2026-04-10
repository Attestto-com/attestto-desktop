<script setup lang="ts">
import { ref, computed } from 'vue'

const activeView = ref<'traditional' | 'structured' | 'comparison'>('comparison')

// The "boring" template — 90% of every mortgage contract
const templateText = `ESCRITURA NÚMERO [protocolo_id] — HIPOTECA EN PRIMER GRADO

Ante mí, [notario_nombre], Notario Público con carné número [notario_carne] del Colegio de Abogados y Abogadas de Costa Rica, con oficina abierta en [notario_oficina], comparecen:

PRIMERO: Como ACREEDOR HIPOTECARIO, [acreedor_nombre], cédula jurídica número [acreedor_cedula], representada en este acto por [representante_nombre], cédula de identidad número [representante_cedula], en su condición de [representante_cargo], con facultades de apoderado generalísimo sin límite de suma, según consta en el Registro Nacional, Sección Mercantil.

SEGUNDO: Como DEUDOR HIPOTECARIO, [deudor_nombre], mayor de edad, [deudor_estado_civil], [deudor_profesion], vecino(a) de [deudor_direccion], portador(a) de la cédula de identidad número [deudor_cedula].

TERCERO: El DEUDOR reconoce adeudar al ACREEDOR la suma de [monto_letras] ([monto_numero]) colones, moneda de curso legal, o su equivalente en dólares de los Estados Unidos de América al tipo de cambio de referencia del Banco Central de Costa Rica vigente al momento del desembolso.

CUARTO: La presente obligación devengará un interés del [interes_porcentaje] por ciento ([interes_numero]%) anual sobre saldos, pagadero en cuotas [periodicidad] de [cuota_monto] colones cada una, que incluyen amortización a capital e intereses, durante un plazo de [plazo_meses] meses, contados a partir de la fecha de constitución de la presente hipoteca.

QUINTO: En caso de mora, el DEUDOR pagará un interés moratorio adicional del [mora_porcentaje] por ciento ([mora_numero]%) anual sobre el saldo en mora.

SEXTO: Para garantizar el fiel cumplimiento de la obligación descrita, el DEUDOR constituye HIPOTECA EN PRIMER GRADO a favor del ACREEDOR, sobre el siguiente inmueble de su propiedad, inscrito en el Registro Nacional, Sección de la Propiedad, bajo:

Finca de [provincia] matrícula de Folio Real número [finca_matricula], que es terreno para [finca_uso], situada en el distrito [finca_distrito], cantón [finca_canton], provincia de [finca_provincia], con una medida de [finca_area] metros cuadrados, con los linderos: al Norte, [lindero_norte]; al Sur, [lindero_sur]; al Este, [lindero_este]; al Oeste, [lindero_oeste].

SÉPTIMO: El DEUDOR declara que el inmueble hipotecado se encuentra libre de gravámenes, anotaciones y limitaciones, salvo las que aparezcan inscritas en el Registro Nacional.

OCTAVO: El DEUDOR se compromete a mantener asegurado el inmueble contra todo riesgo, con una póliza cuyo beneficiario sea el ACREEDOR, por un monto no inferior al valor de la hipoteca.

NOVENO: Serán causales de vencimiento anticipado: a) la falta de pago de dos o más cuotas consecutivas; b) la disminución del valor de la garantía; c) el incumplimiento de cualquier otra obligación aquí pactada.

DÉCIMO: Para todos los efectos legales, las partes señalan como domicilio la ciudad de [domicilio_legal], sometiéndose a la jurisdicción de los tribunales de dicha ciudad, y renunciando al fuero de su domicilio.

Es todo. Expido un primer testimonio para el ACREEDOR. Leída la presente escritura a los comparecientes, manifiestan su conformidad y firmamos en [lugar_firma], a las [hora_firma] horas del [fecha_firma].`

// The structured payload — only the variables
const structuredPayload = {
  protocolo_id: '455-2026',
  template_ref: 'template:cr:hipoteca_v2026',
  version: '1.0',
  variables: {
    notario: {
      nombre: 'Lic. Carlos Méndez Solano',
      carne: '14523',
      oficina: 'San José, Barrio Escalante, 200m norte del Parque Francia',
    },
    acreedor: {
      nombre: 'Banco Nacional de Costa Rica',
      cedula: '4-000-001021',
      representante: 'María Fernanda Jiménez Rojas',
      representante_cedula: '1-1234-0567',
      representante_cargo: 'Gerente de Crédito',
    },
    deudor: {
      nombre: 'Juan Carlos Pérez Mora',
      cedula: '1-0987-0654',
      estado_civil: 'casado',
      profesion: 'ingeniero civil',
      direccion: 'Escazú, San Rafael, Residencial Las Palmas, casa 23',
    },
    obligacion: {
      monto: 50000000,
      monto_letras: 'cincuenta millones',
      moneda: 'CRC',
      interes_anual: 12.5,
      mora_anual: 3.0,
      plazo_meses: 240,
      periodicidad: 'mensual',
      cuota: 562500,
    },
    garantia: {
      provincia: 'San José',
      matricula: '1-234567-000',
      uso: 'habitación',
      distrito: 'San Rafael',
      canton: 'Escazú',
      area_m2: 350,
      linderos: {
        norte: 'calle pública',
        sur: 'lote 24',
        este: 'río Tiribí',
        oeste: 'servidumbre de paso',
      },
    },
    firma: {
      lugar: 'San José',
      fecha: '2026-04-04',
      hora: '10:00',
      domicilio_legal: 'San José',
    },
  },
  proof: {
    signature_deudor: '0xabc123...def456',
    signature_acreedor: '0xfed321...cba654',
    signature_notario: '0x789abc...321fed',
    method: 'PAdES + attestto_sign',
    anchor: 'solana:tx:4k8f2a...c7e1b3',
    timestamp: '2026-04-04T10:15:32Z',
  },
}

const templateSize = computed(() => {
  const bytes = new TextEncoder().encode(templateText).length
  return (bytes / 1024).toFixed(1)
})

const payloadSize = computed(() => {
  const bytes = new TextEncoder().encode(JSON.stringify(structuredPayload)).length
  return (bytes / 1024).toFixed(1)
})

const compressionRatio = computed(() => {
  const templateBytes = new TextEncoder().encode(templateText).length
  const payloadBytes = new TextEncoder().encode(JSON.stringify(structuredPayload)).length
  return ((1 - payloadBytes / templateBytes) * 100).toFixed(0)
})

// Simulate what 100 mortgages look like
const traditionalTotal = computed(() => {
  // 100 full documents at ~5MB each (with formatting, stamps, etc.)
  return '500 MB'
})

const structuredTotal = computed(() => {
  // 1 template (3KB) + 100 payloads (~1.5KB each)
  return '153 KB'
})

// Highlight variables in template
const highlightedTemplate = computed(() => {
  return templateText.replace(
    /\[([^\]]+)\]/g,
    '<span class="template-var">[$1]</span>'
  )
})
</script>

<template>
  <q-page class="notary-demo">
    <div class="notary-demo__container">
      <!-- Header -->
      <div class="notary-demo__header">
        <div>
          <div class="text-h5 text-weight-bold att-text-title">Protocolo Notarial Estructurado</div>
          <div class="text-caption att-text-muted">
            Separar datos variables de texto repetido. Transmitir instrucciones, no documentos.
          </div>
        </div>
        <q-btn-toggle
          v-model="activeView"
          flat
          dense
          toggle-color="primary"
          :options="[
            { label: 'Comparar', value: 'comparison' },
            { label: 'Tradicional', value: 'traditional' },
            { label: 'Estructurado', value: 'structured' },
          ]"
        />
      </div>

      <!-- Comparison view -->
      <template v-if="activeView === 'comparison'">
        <!-- Impact stats -->
        <div class="notary-stats">
          <div class="notary-stat">
            <div class="notary-stat__label">Documento tradicional</div>
            <div class="notary-stat__value text-negative">{{ templateSize }} KB</div>
            <div class="notary-stat__sub">Texto completo por documento</div>
          </div>
          <div class="notary-stat notary-stat--arrow">
            <q-icon name="arrow_forward" size="24px" color="primary" />
          </div>
          <div class="notary-stat">
            <div class="notary-stat__label">Payload estructurado</div>
            <div class="notary-stat__value text-positive">{{ payloadSize }} KB</div>
            <div class="notary-stat__sub">Solo datos variables</div>
          </div>
          <div class="notary-stat notary-stat--highlight">
            <div class="notary-stat__label">Compresion</div>
            <div class="notary-stat__value text-accent">{{ compressionRatio }}%</div>
            <div class="notary-stat__sub">Menos datos transmitidos</div>
          </div>
        </div>

        <!-- Scale impact -->
        <div class="notary-scale">
          <div class="text-subtitle2 text-weight-bold att-text-subtitle q-mb-sm">
            Escala: 100 hipotecas con el mismo banco
          </div>
          <div class="notary-scale__row">
            <div class="notary-scale__bar notary-scale__bar--traditional">
              <div class="notary-scale__fill" style="width: 100%;" />
              <span>Tradicional: {{ traditionalTotal }}</span>
              <span class="text-caption att-text-muted">100 PDFs completos</span>
            </div>
            <div class="notary-scale__bar notary-scale__bar--structured">
              <div class="notary-scale__fill" style="width: 0.03%;" />
              <span>Estructurado: {{ structuredTotal }}</span>
              <span class="text-caption att-text-muted">1 plantilla + 100 payloads</span>
            </div>
          </div>
        </div>

        <!-- Side by side -->
        <div class="notary-comparison">
          <div class="notary-panel">
            <div class="notary-panel__header notary-panel__header--old">
              <q-icon name="description" size="16px" />
              Documento Tradicional
              <q-badge color="negative" :label="`${templateSize} KB`" class="q-ml-sm" />
            </div>
            <div class="notary-panel__content notary-panel__content--template" v-html="highlightedTemplate" />
          </div>

          <div class="notary-panel">
            <div class="notary-panel__header notary-panel__header--new">
              <q-icon name="data_object" size="16px" />
              Payload Estructurado
              <q-badge color="positive" :label="`${payloadSize} KB`" class="q-ml-sm" />
            </div>
            <pre class="notary-panel__content notary-panel__content--json">{{ JSON.stringify(structuredPayload, null, 2) }}</pre>
          </div>
        </div>

        <!-- How it works -->
        <div class="notary-flow">
          <div class="text-subtitle2 text-weight-bold att-text-subtitle q-mb-md">Como funciona</div>
          <div class="notary-flow__steps">
            <div class="notary-flow__step">
              <div class="notary-flow__icon"><q-icon name="storage" size="24px" color="primary" /></div>
              <div class="notary-flow__label">Plantilla inmutable</div>
              <div class="notary-flow__desc">Se almacena UNA vez. Hash anclado en Solana. Todos los notarios la referencian.</div>
            </div>
            <div class="notary-flow__arrow"><q-icon name="arrow_forward" color="grey-7" /></div>
            <div class="notary-flow__step">
              <div class="notary-flow__icon"><q-icon name="data_object" size="24px" color="accent" /></div>
              <div class="notary-flow__label">Payload variable</div>
              <div class="notary-flow__desc">Solo los datos unicos viajan: nombres, montos, matriculas. ~1.5 KB.</div>
            </div>
            <div class="notary-flow__arrow"><q-icon name="arrow_forward" color="grey-7" /></div>
            <div class="notary-flow__step">
              <div class="notary-flow__icon"><q-icon name="draw" size="24px" color="secondary" /></div>
              <div class="notary-flow__label">Firmas PAdES</div>
              <div class="notary-flow__desc">Cada parte firma el hash del payload con su llave local. DIDComm orquesta.</div>
            </div>
            <div class="notary-flow__arrow"><q-icon name="arrow_forward" color="grey-7" /></div>
            <div class="notary-flow__step">
              <div class="notary-flow__icon"><q-icon name="link" size="24px" color="positive" /></div>
              <div class="notary-flow__label">Ancla Solana</div>
              <div class="notary-flow__desc">Hash del payload + firmas → 1 transaccion. Prueba inmutable. $0.00025.</div>
            </div>
          </div>
        </div>

        <!-- Render on demand -->
        <div class="notary-render">
          <q-icon name="auto_fix_high" size="20px" color="grey-5" />
          <div>
            <div class="text-caption att-text-body text-weight-bold">Renderizado bajo demanda</div>
            <div class="text-caption att-text-muted">
              El "documento legible" se genera en tiempo real: plantilla + variables = PDF visual.
              Solo cuando alguien necesita leerlo. El texto legal es una mascara, no la verdad — la verdad es el payload firmado.
            </div>
          </div>
        </div>
      </template>

      <!-- Traditional full view -->
      <template v-if="activeView === 'traditional'">
        <div class="notary-full-doc">
          <div class="notary-full-doc__header">
            <q-icon name="description" size="20px" color="negative" />
            <span class="att-text-subtitle">Documento completo — {{ templateSize }} KB de texto</span>
          </div>
          <div class="notary-panel__content notary-panel__content--template notary-panel__content--full" v-html="highlightedTemplate" />
        </div>
      </template>

      <!-- Structured full view -->
      <template v-if="activeView === 'structured'">
        <div class="notary-full-doc">
          <div class="notary-full-doc__header">
            <q-icon name="data_object" size="20px" color="positive" />
            <span class="att-text-subtitle">Payload estructurado — {{ payloadSize }} KB</span>
          </div>
          <pre class="notary-panel__content notary-panel__content--json notary-panel__content--full">{{ JSON.stringify(structuredPayload, null, 2) }}</pre>
        </div>
      </template>
    </div>
  </q-page>
</template>
