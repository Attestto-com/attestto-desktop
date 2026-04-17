// ── TSE Padrón Electoral Service ──
// Downloads canton-level voter registry ZIPs from TSE,
// parses the TXT (latin1, comma-separated), and stores
// records in a local SQLite database for offline lookup.
//
// TSE record format:
//   CEDULA(9), CODELEC(6), RELLENO(1), FECHACADUC(8), JUNTA(5), NOMBRE(30), APELLIDO1(26), APELLIDO2(26)
//
// Source: https://www.tse.go.cr/descarga_padron.htm

import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'

const TSE_BASE = 'https://www.tse.go.cr/zip/padron'

export interface PadronRecord {
  cedula: string
  codelec: string
  fechacaduc: string | null
  junta: string
  nombre: string
  apellido1: string
  apellido2: string | null
}

export interface PadronLookupResult {
  found: boolean
  record?: PadronRecord
  cantonName?: string
  provinceName?: string
  nombreCompleto?: string
}

export interface PadronStatus {
  initialized: boolean
  cantonCode: string | null
  cantonName: string | null
  recordCount: number
  lastUpdated: string | null
}

export class PadronService {
  private db: Database.Database | null = null
  private dbPath: string

  constructor() {
    const dataDir = join(app.getPath('userData'), 'padron')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
    this.dbPath = join(dataDir, 'padron.db')
  }

  /** Initialize SQLite database with schema */
  init(): void {
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS padron (
        cedula TEXT PRIMARY KEY,
        codelec TEXT NOT NULL,
        fechacaduc TEXT,
        junta TEXT NOT NULL,
        nombre TEXT NOT NULL,
        apellido1 TEXT NOT NULL,
        apellido2 TEXT
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_padron_codelec ON padron(codelec)
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS padron_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  }

  /** Download a canton ZIP from TSE, parse, and store in SQLite */
  async downloadCanton(zipFilename: string, cantonCode: string, cantonName: string): Promise<number> {
    if (!this.db) this.init()

    const url = `${TSE_BASE}/${zipFilename}`
    const tempDir = join(app.getPath('userData'), 'padron', 'temp')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    // Download ZIP
    const response = await fetch(url, {
      signal: AbortSignal.timeout(120_000), // 2 min timeout
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`TSE download failed: ${response.status} ${response.statusText}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const zipPath = join(tempDir, zipFilename)
    writeFileSync(zipPath, buffer)

    // Extract and parse
    let recordCount = 0
    try {
      const AdmZip = (await import('adm-zip')).default
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()

      // Find the padron TXT (not LEAME, not DISTELEC)
      const txtEntry = entries.find(e => {
        const n = e.entryName.toUpperCase()
        return n.endsWith('.TXT') && !n.includes('LEAME') && !n.includes('DISTELEC')
      })

      if (!txtEntry) {
        throw new Error('No padron TXT found in ZIP')
      }

      // TSE files are latin1 encoded
      const iconv = (await import('iconv-lite')).default
      const content = iconv.decode(txtEntry.getData(), 'latin1')
      const lines = content.split('\n').filter(l => l.trim())

      // ATT-276: parameterized query to prevent SQL injection
      // Validate canton code format (3-digit numeric string)
      if (!/^\d{3}$/.test(cantonCode)) {
        throw new Error(`Invalid canton code format: ${cantonCode}`)
      }
      this.db!.prepare('DELETE FROM padron WHERE substr(codelec, 1, 3) = ?').run(cantonCode)

      // Batch insert
      const insert = this.db!.prepare(`
        INSERT OR REPLACE INTO padron (cedula, codelec, fechacaduc, junta, nombre, apellido1, apellido2)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      const insertMany = this.db!.transaction((records: PadronRecord[]) => {
        for (const rec of records) {
          insert.run(rec.cedula, rec.codelec, rec.fechacaduc, rec.junta, rec.nombre, rec.apellido1, rec.apellido2)
        }
      })

      const batch: PadronRecord[] = []
      for (const line of lines) {
        const record = this.parseLine(line)
        if (record) {
          batch.push(record)
          if (batch.length >= 500) {
            insertMany(batch)
            recordCount += batch.length
            batch.length = 0
          }
        }
      }

      // Remaining batch
      if (batch.length > 0) {
        insertMany(batch)
        recordCount += batch.length
      }

      // Update metadata
      const upsertMeta = this.db!.prepare(`
        INSERT OR REPLACE INTO padron_meta (key, value) VALUES (?, ?)
      `)
      upsertMeta.run('canton_code', cantonCode)
      upsertMeta.run('canton_name', cantonName)
      upsertMeta.run('last_updated', new Date().toISOString())
      upsertMeta.run('record_count', recordCount.toString())

    } finally {
      // Clean up temp ZIP
      try { unlinkSync(zipPath) } catch { /* ignore */ }
    }

    return recordCount
  }

  /** Look up a cédula in the local database */
  lookupCedula(cedula: string): PadronLookupResult {
    if (!this.db) this.init()

    const clean = cedula.replace(/[^0-9]/g, '')
    if (clean.length !== 9) {
      return { found: false }
    }

    const row = this.db!.prepare('SELECT * FROM padron WHERE cedula = ?').get(clean) as PadronRecord | undefined

    if (!row) {
      return { found: false }
    }

    const nombreCompleto = [row.nombre, row.apellido1, row.apellido2]
      .filter(Boolean)
      .map(s => s!.trim())
      .join(' ')

    return {
      found: true,
      record: row,
      nombreCompleto,
    }
  }

  /** Get current status of the local padron database */
  getStatus(): PadronStatus {
    if (!this.db) this.init()

    const getMeta = this.db!.prepare('SELECT value FROM padron_meta WHERE key = ?')

    const cantonCode = (getMeta.get('canton_code') as any)?.value || null
    const cantonName = (getMeta.get('canton_name') as any)?.value || null
    const lastUpdated = (getMeta.get('last_updated') as any)?.value || null
    const recordCount = parseInt((getMeta.get('record_count') as any)?.value || '0', 10)

    return {
      initialized: recordCount > 0,
      cantonCode,
      cantonName,
      recordCount,
      lastUpdated,
    }
  }

  /** Check if a canton is already downloaded */
  hasCantonData(cantonCode: string): boolean {
    if (!this.db) this.init()
    const count = this.db!.prepare('SELECT COUNT(*) as cnt FROM padron WHERE substr(codelec, 1, 3) = ?').get(cantonCode) as any
    return (count?.cnt || 0) > 0
  }

  /**
   * Parse a TSE padron line
   * Format: CEDULA,CODELEC,RELLENO,FECHACADUC,JUNTA,NOMBRE,APELLIDO1,APELLIDO2
   */
  private parseLine(line: string): PadronRecord | null {
    const parts = line.split(',')
    if (parts.length < 8) return null

    const cedula = parts[0].trim()
    if (!/^\d{9}$/.test(cedula)) return null

    return {
      cedula,
      codelec: parts[1].trim(),
      fechacaduc: parts[3].trim() || null,
      junta: parts[4].trim(),
      nombre: parts[5].trim(),
      apellido1: parts[6].trim(),
      apellido2: parts[7]?.trim() || null,
    }
  }

  /** Close the database connection */
  close(): void {
    this.db?.close()
    this.db = null
  }
}
