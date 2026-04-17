/**
 * Security fixes — ATT-275 + ATT-276
 *
 * ATT-276: SQL injection in padron canton deletion → parameterized query + validation
 * ATT-275: CORS wildcard on capture server → restricted to served origin
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function readSource(relativePath: string): string {
  return readFileSync(join(__dirname, '..', relativePath), 'utf-8')
}

describe('ATT-276: SQL injection prevention in padron-service', () => {
  const source = () => readSource('src/main/padron/padron-service.ts')

  it('uses parameterized query (prepare + run), not exec with template literal', () => {
    const content = source()
    // Must NOT have the vulnerable pattern
    expect(content).not.toMatch(/exec\(`DELETE FROM padron.*\$\{cantonCode\}/)
    // Must have the safe pattern
    expect(content).toContain(".prepare('DELETE FROM padron WHERE substr(codelec, 1, 3) = ?').run(cantonCode)")
  })

  it('validates canton code format before deletion', () => {
    const content = source()
    expect(content).toContain('.test(cantonCode)')
    expect(content).toContain('^\\d{3}$')
  })

  it('throws on invalid canton code', () => {
    const content = source()
    expect(content).toContain('Invalid canton code format')
  })

  // Pure function test: validate the regex
  it('canton code regex accepts valid codes', () => {
    const regex = /^\d{3}$/
    expect(regex.test('101')).toBe(true)
    expect(regex.test('201')).toBe(true)
    expect(regex.test('999')).toBe(true)
  })

  it('canton code regex rejects injection attempts', () => {
    const regex = /^\d{3}$/
    expect(regex.test("' OR '1'='1")).toBe(false)
    expect(regex.test('; DROP TABLE padron')).toBe(false)
    expect(regex.test('10')).toBe(false)
    expect(regex.test('1234')).toBe(false)
    expect(regex.test('abc')).toBe(false)
    expect(regex.test('')).toBe(false)
  })
})

describe('ATT-275: CORS restriction on capture server', () => {
  const source = () => readSource('src/main/capture/capture-server.ts')

  it('does NOT use wildcard CORS origin', () => {
    const content = source()
    expect(content).not.toContain("'*'")
  })

  it('restricts origin to the local server address', () => {
    const content = source()
    expect(content).toContain('allowedOrigin')
    expect(content).toMatch(/https:\/\/\$\{localIP\}:\$\{this\.port\}/)
  })

  it('still sets CORS methods and headers', () => {
    const content = source()
    expect(content).toContain('Access-Control-Allow-Methods')
    expect(content).toContain('Access-Control-Allow-Headers')
  })
})
