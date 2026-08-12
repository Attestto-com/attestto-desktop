import { describe, it, expect } from 'vitest'
import { sanitizeName } from '@/renderer/country/cr/name-utils'

describe('sanitizeName', () => {
  it('rejects a single stray letter (the OCR bug that got saved into a credential)', () => {
    expect(sanitizeName('a')).toBe('')
    expect(sanitizeName('A')).toBe('')
    expect(sanitizeName(' a ')).toBe('')
  })

  it('rejects empty / whitespace / punctuation-only values', () => {
    expect(sanitizeName('')).toBe('')
    expect(sanitizeName('   ')).toBe('')
    expect(sanitizeName('.:-')).toBe('')
  })

  it('rejects values with no word of at least two letters', () => {
    expect(sanitizeName('a b c')).toBe('')
    expect(sanitizeName('x 1 y')).toBe('')
  })

  it('accepts plausible Costa Rican given names and surnames', () => {
    expect(sanitizeName('ANA')).toBe('ANA')
    expect(sanitizeName('José')).toBe('José')
    expect(sanitizeName('María Fernanda')).toBe('María Fernanda')
    expect(sanitizeName('JIMÉNEZ')).toBe('JIMÉNEZ')
    expect(sanitizeName('Ñañez')).toBe('Ñañez')
  })

  it('strips digits and stray symbols but keeps the name when a real word remains', () => {
    expect(sanitizeName('JOSE1')).toBe('JOSE')
    expect(sanitizeName('  Pérez  ')).toBe('Pérez')
    expect(sanitizeName('JOSE A PEREZ')).toBe('JOSE A PEREZ')
  })
})
