<script setup lang="ts">
import { ref } from 'vue'

const sessionType = ref<string | null>(null)
</script>

<template>
  <q-page class="page-centered">
    <div class="page-centered__container">
    <div class="text-h4 text-weight-bold q-mb-sm">Sesión de Presencia</div>
    <div class="att-text-body q-mb-xl">Presencia remota verificada con identidad digital</div>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-4" v-for="option in [
        { value: 'hearing', icon: 'gavel', label: 'Comparecencia', desc: 'Poder Judicial — audiencia remota', color: 'primary' },
        { value: 'tramite', icon: 'description', label: 'Trámite Municipal', desc: 'Municipalidad — presencia verificada', color: 'secondary' },
        { value: 'notarial', icon: 'edit_note', label: 'Acto Notarial', desc: 'Notario — firma con testigos', color: 'accent' },
      ]" :key="option.value">
        <q-card
          flat bordered
          class="bg-dark cursor-pointer"
          :class="{ 'border-primary': sessionType === option.value }"
          @click="sessionType = option.value"
        >
          <q-card-section class="text-center q-pa-lg">
            <q-icon :name="option.icon" size="56px" :color="option.color" />
            <div class="text-h6 q-mt-md">{{ option.label }}</div>
            <div class="text-caption att-text-body">{{ option.desc }}</div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <div v-if="sessionType" class="q-mt-xl">
      <q-banner class="bg-dark-page rounded-borders">
        <template v-slot:avatar><q-icon name="info" color="info" /></template>
        Módulo de {{ sessionType }} en desarrollo. La arquitectura de presencia verificada
        es idéntica al módulo de examen: identidad DID + cámara + proctoring + auditoría + VC.
      </q-banner>
    </div>
    </div>
  </q-page>
</template>
