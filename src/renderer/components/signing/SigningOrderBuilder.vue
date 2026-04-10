<script setup lang="ts">
import { ref, computed } from 'vue'

export interface Signer {
  id: string
  did: string
  name: string
  role: string
  position: number
  mode: 'sequential' | 'parallel'
  methods: string[]
  status: 'pending' | 'signed' | 'rejected'
}

const props = defineProps<{
  modelValue: Signer[]
}>()

const emit = defineEmits<{
  'update:modelValue': [signers: Signer[]]
}>()

const availableMethods = [
  // Tier 1: Anyone with verified identity (liveness + cédula + padrón)
  { value: 'attestto_sign', label: 'Attestto Sign (DID)', icon: 'verified_user', trust: 'B', description: 'Firma con llave DID — respaldada por liveness + padron' },
  // Tier 2: Firma Digital hardware (lawyers, notaries, government)
  { value: 'firma_digital_cr', label: 'Firma Digital (SINPE)', icon: 'security', trust: 'A+', description: 'Tarjeta inteligente SINPE — validez legal Ley 8454' },
  // Tier 3 (future): Derived from Firma Digital cert
  { value: 'firma_derivada', label: 'Firma Derivada', icon: 'link', trust: 'A', description: 'DID vinculado a certificado SINPE — requiere cambio legal' },
  // Supporting methods
  { value: 'biometric', label: 'Biometrico', icon: 'fingerprint', trust: 'B+', description: 'Liveness biometrico durante la firma' },
  { value: 'witness_signature', label: 'Testigo', icon: 'group', trust: 'B', description: 'Firmante presencial como testigo' },
  { value: 'simple_electronic', label: 'Electronica simple', icon: 'email', trust: 'C', description: 'Email + clic — sin verificacion de identidad' },
]

const showAddDialog = ref(false)
const newSigner = ref({
  did: '',
  name: '',
  role: '',
  methods: ['attestto_sign'] as string[],
})

// Group signers by position for visual grouping
const signerGroups = computed(() => {
  const groups: Record<number, Signer[]> = {}
  for (const s of props.modelValue) {
    if (!groups[s.position]) groups[s.position] = []
    groups[s.position].push(s)
  }
  return Object.entries(groups)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([pos, signers]) => ({
      position: Number(pos),
      signers,
      mode: signers[0]?.mode || 'sequential',
    }))
})

const nextPosition = computed(() => {
  if (props.modelValue.length === 0) return 1
  return Math.max(...props.modelValue.map(s => s.position)) + 1
})

function addSigner(parallel: boolean) {
  const position = parallel && props.modelValue.length > 0
    ? props.modelValue[props.modelValue.length - 1].position
    : nextPosition.value

  const signer: Signer = {
    id: crypto.randomUUID(),
    did: newSigner.value.did,
    name: newSigner.value.name,
    role: newSigner.value.role,
    position,
    mode: parallel ? 'parallel' : 'sequential',
    methods: [...newSigner.value.methods],
    status: 'pending',
  }

  emit('update:modelValue', [...props.modelValue, signer])
  resetNewSigner()
  showAddDialog.value = false
}

function removeSigner(id: string) {
  emit('update:modelValue', props.modelValue.filter(s => s.id !== id))
}

function moveUp(id: string) {
  const signers = [...props.modelValue]
  const idx = signers.findIndex(s => s.id === id)
  if (idx <= 0) return
  const signer = signers[idx]
  if (signer.position > 1) {
    signer.position--
    emit('update:modelValue', signers)
  }
}

function moveDown(id: string) {
  const signers = [...props.modelValue]
  const idx = signers.findIndex(s => s.id === id)
  if (idx < 0) return
  const signer = signers[idx]
  signer.position++
  emit('update:modelValue', signers)
}

function resetNewSigner() {
  newSigner.value = { did: '', name: '', role: '', methods: ['attestto_sign'] }
}

function trustColor(trust: string) {
  if (trust.startsWith('A')) return 'positive'
  if (trust.startsWith('B')) return 'primary'
  return 'grey-6'
}
</script>

<template>
  <div class="signing-order">
    <!-- Header -->
    <div class="signing-order__header">
      <div>
        <div class="text-subtitle1 text-weight-bold att-text-title">Orden de firma</div>
        <div class="text-caption att-text-muted">
          Arrastra para reordenar. Firmantes en la misma posicion firman en paralelo.
        </div>
      </div>
      <q-btn
        color="primary"
        icon="person_add"
        label="Agregar firmante"
        size="sm"
        @click="showAddDialog = true"
      />
    </div>

    <!-- Empty state -->
    <div v-if="modelValue.length === 0" class="signing-order__empty">
      <q-icon name="draw" size="48px" color="grey-7" />
      <div class="att-text-body q-mt-sm">No hay firmantes</div>
      <div class="text-caption att-text-disabled">Agrega firmantes para definir el flujo de firma</div>
    </div>

    <!-- Signer groups -->
    <div v-for="group in signerGroups" :key="group.position" class="signing-group">
      <div class="signing-group__position">
        <div class="signing-group__number">{{ group.position }}</div>
        <div class="signing-group__mode">
          <q-icon
            :name="group.signers.length > 1 ? 'call_split' : 'arrow_downward'"
            size="14px"
            :color="group.signers.length > 1 ? 'accent' : 'grey-6'"
          />
          <span class="text-caption" :class="group.signers.length > 1 ? 'text-accent' : 'att-text-muted'">
            {{ group.signers.length > 1 ? 'Paralelo' : 'Secuencial' }}
          </span>
        </div>
      </div>

      <div class="signing-group__signers">
        <div
          v-for="signer in group.signers"
          :key="signer.id"
          class="signer-card"
        >
          <div class="signer-card__main">
            <div class="signer-card__avatar">
              <q-icon name="person" size="20px" color="primary" />
            </div>
            <div class="signer-card__info">
              <div class="text-body2 text-weight-bold att-text-title">{{ signer.name }}</div>
              <div class="text-caption att-text-body">{{ signer.role }}</div>
              <div class="text-caption att-text-disabled att-text-mono">
                {{ signer.did }}
              </div>
            </div>
          </div>

          <div class="signer-card__methods">
            <q-badge
              v-for="method in signer.methods"
              :key="method"
              outline
              :color="trustColor(availableMethods.find(m => m.value === method)?.trust || 'C')"
              :label="availableMethods.find(m => m.value === method)?.label || method"
              class="q-mr-xs"
            />
          </div>

          <div class="signer-card__actions">
            <q-btn flat dense round icon="keyboard_arrow_up" size="xs" @click="moveUp(signer.id)" />
            <q-btn flat dense round icon="keyboard_arrow_down" size="xs" @click="moveDown(signer.id)" />
            <q-btn flat dense round icon="close" size="xs" color="negative" @click="removeSigner(signer.id)" />
          </div>
        </div>
      </div>

      <!-- Arrow between groups -->
      <div v-if="group.position < signerGroups.length" class="signing-group__arrow">
        <q-icon name="arrow_downward" size="16px" color="grey-7" />
      </div>
    </div>

    <!-- Add signer dialog -->
    <q-dialog v-model="showAddDialog" @hide="resetNewSigner">
      <q-card class="bg-dark" style="min-width: 400px;">
        <q-card-section>
          <div class="text-h6 att-text-title">Agregar firmante</div>
        </q-card-section>

        <q-card-section class="q-pt-none q-gutter-md">
          <q-input
            v-model="newSigner.name"
            label="Nombre"
            dark
            outlined
            dense
          />
          <q-input
            v-model="newSigner.did"
            label="DID"
            dark
            outlined
            dense
            placeholder="did:sns:example.sol"
            hint="Identificador descentralizado del firmante"
          />
          <q-input
            v-model="newSigner.role"
            label="Rol"
            dark
            outlined
            dense
            placeholder="Acreedor, Deudor, Notario..."
          />
          <q-select
            v-model="newSigner.methods"
            :options="availableMethods"
            option-value="value"
            option-label="label"
            label="Metodos de firma permitidos"
            dark
            outlined
            dense
            multiple
            emit-value
            map-options
          >
            <template #option="{ itemProps, opt, selected, toggleOption }">
              <q-item v-bind="itemProps">
                <q-item-section side>
                  <q-checkbox :model-value="selected" @update:model-value="toggleOption(opt)" />
                </q-item-section>
                <q-item-section avatar>
                  <q-icon :name="opt.icon" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ opt.label }}</q-item-label>
                  <q-item-label caption>Confianza: {{ opt.trust }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-badge :color="trustColor(opt.trust)" :label="opt.trust" />
                </q-item-section>
              </q-item>
            </template>
          </q-select>
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat label="Cancelar" @click="showAddDialog = false" />
          <q-btn
            flat
            color="accent"
            label="Paralelo (misma posicion)"
            icon="call_split"
            :disable="!newSigner.name || !newSigner.did || modelValue.length === 0"
            @click="addSigner(true)"
          />
          <q-btn
            color="primary"
            label="Agregar"
            icon="person_add"
            :disable="!newSigner.name || !newSigner.did"
            @click="addSigner(false)"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>
