import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/main/pki/firma-validator.ts',
        'src/main/pdf/incremental-info-update.ts',
      ],
      reporter: ['text', 'text-summary'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 30,
      },
    },
  },
})
