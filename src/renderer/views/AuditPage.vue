<script setup lang="ts">
const columns = [
  { name: 'timestamp', label: 'Fecha/Hora', field: 'timestamp', align: 'left' as const },
  { name: 'event', label: 'Evento', field: 'event', align: 'left' as const },
  { name: 'type', label: 'Tipo', field: 'type', align: 'left' as const },
  { name: 'hash', label: 'Hash', field: 'hash', align: 'left' as const },
  { name: 'solana', label: 'Ancla Solana', field: 'solana', align: 'left' as const },
]
</script>

<template>
  <q-page style="padding: 2.5rem;">
    <div class="text-h4 text-weight-bold q-mb-sm">Auditoría</div>
    <div class="att-text-body q-mb-xl">Registro inmutable de todas las sesiones y eventos</div>

    <q-table
      flat bordered
      :rows="[]"
      :columns="columns"
      row-key="timestamp"
      no-data-label="No hay eventos de auditoría registrados"
      class="bg-dark"
      dark
    />

    <q-banner class="bg-dark-page rounded-borders q-mt-lg">
      <template v-slot:avatar><q-icon name="shield" color="primary" /></template>
      Cada evento se registra con hash SHA-256 y se ancla en Solana para
      garantizar inmutabilidad. Los registros son exportables en formato JSON
      para auditorías externas (MICITT obs. 5 y 7).
    </q-banner>
  </q-page>
</template>
