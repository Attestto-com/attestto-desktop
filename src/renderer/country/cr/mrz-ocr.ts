// ── MRZ OCR for Costa Rica Cédula ──
// Uses Tesseract.js to extract text from the back of the cédula,
// then parses the MRZ (Machine Readable Zone) — 3 lines at the bottom.
//
// MRZ format (ICAO TD1 — 3 lines of 30 chars):
//   Line 1: IDCRI + cédula(9) + check + document number + filler
//   Line 2: DOB(YYMMDD) + check + sex + expiry(YYMMDD) + check + nationality + filler + check
//   Line 3: APELLIDO1<APELLIDO2<<NOMBRE1<NOMBRE2
//
// All processing is 100% local — nothing leaves the device.

import Tesseract from 'tesseract.js'

export interface MRZResult {
  success: boolean
  cedula: string
  nombre: string
  apellido1: string
  apellido2: string
  fechaNacimiento: string    // DD/MM/YYYY
  fechaVencimiento: string   // DD/MM/YYYY
  nacionalidad: string
  sexo: string
  rawMRZ: string[]
  confidence: number
  source?: 'mrz' | 'front-ocr'  // where the data came from
}

export interface DocumentAnalysis {
  format: 'new' | 'old' | 'unknown'  // new = has MRZ/QR, old = pre-2020
  damaged: boolean
  damageNotes: string[]
  croppedFront: string | null   // auto-cropped card image
  croppedBack: string | null
}

/**
 * Crop the bottom portion of an image where the MRZ lives (bottom ~30%).
 * Also preprocesses: grayscale + high contrast + threshold for clean OCR.
 */
function cropMRZRegion(imageSource: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!

      // MRZ is in the bottom ~30% of a TD1 card
      const cropRatio = 0.35
      const cropY = Math.floor(img.height * (1 - cropRatio))
      const cropH = img.height - cropY

      canvas.width = img.width
      canvas.height = cropH

      // Draw cropped region
      ctx.drawImage(img, 0, cropY, img.width, cropH, 0, 0, img.width, cropH)

      // Preprocess: grayscale + threshold for black-on-white MRZ text
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      for (let i = 0; i < data.length; i += 4) {
        // Grayscale
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        // Threshold: MRZ text is dark on light background
        const val = gray < 140 ? 0 : 255
        data[i] = val
        data[i + 1] = val
        data[i + 2] = val
      }
      ctx.putImageData(imageData, 0, 0)

      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image for MRZ crop'))
    img.src = imageSource
  })
}

/**
 * Extract MRZ text from the back of a cédula image using Tesseract.js OCR.
 * Crops the MRZ region first, then preprocesses for better accuracy.
 * The image can be a base64 data URL or an HTMLImageElement.
 */
export async function extractMRZFromImage(
  imageSource: string,
  onProgress?: (progress: number) => void,
): Promise<MRZResult> {
  const empty: MRZResult = {
    success: false,
    cedula: '', nombre: '', apellido1: '', apellido2: '',
    fechaNacimiento: '', fechaVencimiento: '',
    nacionalidad: '', sexo: '',
    rawMRZ: [], confidence: 0,
  }

  try {
    // Step 1: Crop and preprocess the MRZ region for better accuracy
    let mrzImage: string
    try {
      mrzImage = await cropMRZRegion(imageSource)
    } catch {
      // If crop fails (e.g. CORS), fall back to full image
      mrzImage = imageSource
    }

    // Step 2: Run OCR on cropped MRZ region with optimized settings
    const worker = await Tesseract.createWorker('eng', undefined, {
      logger: (m: any) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100))
        }
      },
    })

    // MRZ uses only these characters — whitelist improves accuracy significantly
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    })

    const result = await worker.recognize(mrzImage)
    await worker.terminate()

    const fullText = result.data.text
    const confidence = result.data.confidence

    // Find MRZ lines — they contain IDCRI, < characters, and are mostly uppercase
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 10)

    // MRZ lines have lots of < characters and are ~30 chars
    let mrzLines = findMRZLines(lines)

    if (mrzLines.length < 2) {
      // Try harder: clean up common OCR mistakes in MRZ
      const cleaned = lines.map(cleanMRZLine).filter(l => l.length >= 25)
      mrzLines = findMRZLines(cleaned)
      if (mrzLines.length < 2) {
        // Last resort: try full image without crop
        const fullResult = await Tesseract.recognize(imageSource, 'eng', {
          logger: (m: any) => {
            if (m.status === 'recognizing text' && onProgress) {
              onProgress(Math.round(m.progress * 100))
            }
          },
        })
        const fullLines = fullResult.data.text.split('\n').map(l => l.trim()).filter(l => l.length > 10)
        mrzLines = findMRZLines(fullLines)
        if (mrzLines.length < 2) {
          const cleanedFull = fullLines.map(cleanMRZLine).filter(l => l.length >= 25)
          mrzLines = findMRZLines(cleanedFull)
        }
        if (mrzLines.length < 2) return { ...empty, confidence: fullResult.data.confidence }
        return parseMRZ(mrzLines, fullResult.data.confidence)
      }
    }

    return parseMRZ(mrzLines, confidence)
  } catch (err) {
    console.error('[mrz-ocr] OCR failed:', err)
    return empty
  }
}

/** Find the MRZ lines from OCR text output */
function findMRZLines(lines: string[]): string[] {
  const mrzCandidates: string[] = []

  for (const line of lines) {
    const cleaned = cleanMRZLine(line)
    // MRZ lines have < characters and are mostly A-Z, 0-9, <
    const mrzChars = cleaned.replace(/[^A-Z0-9<]/g, '')
    if (mrzChars.length >= 25 && (cleaned.includes('<') || cleaned.startsWith('IDCRI'))) {
      mrzCandidates.push(mrzChars)
    }
  }

  // Should be 3 lines for TD1 format
  return mrzCandidates.slice(0, 3)
}

/** Clean common OCR mistakes in MRZ text */
function cleanMRZLine(line: string): string {
  return line
    .toUpperCase()
    .replace(/[|]/g, '<')     // pipes → chevrons
    .replace(/\s+/g, '')       // remove spaces
    .replace(/O(?=\d)/g, '0')  // O before digit → 0
    .replace(/(?<=\d)O/g, '0') // O after digit → 0
    .replace(/(?<=\d)I/g, '1') // I after digit → 1
    .replace(/I(?=\d)/g, '1')  // I before digit → 1
    .replace(/[()]/g, '<')     // parentheses → chevrons
    .replace(/[{}]/g, '<')     // braces → chevrons
    .replace(/[_-]/g, '<')     // underscores/hyphens → chevrons
}

/** Parse extracted MRZ lines into structured data */
function parseMRZ(mrzLines: string[], confidence: number): MRZResult {
  const empty: MRZResult = {
    success: false,
    cedula: '', nombre: '', apellido1: '', apellido2: '',
    fechaNacimiento: '', fechaVencimiento: '',
    nacionalidad: '', sexo: '',
    rawMRZ: mrzLines, confidence,
  }

  // Line 1: IDCRI + cédula number.
  // Tesseract often reads the trailing `I` of `IDCRI` as `1`, so accept both
  // `IDCRI` and `IDCR1`. Take exactly 9 digits — the 10th is the check digit
  // and including it pushes the format slicer one position off.
  const line1 = mrzLines[0] || ''
  let cedula = ''
  const idMatch = line1.match(/IDCR[I1](\d{9})/)
  if (idMatch) {
    cedula = idMatch[1]
  } else {
    // Last-resort fallback: first 9 consecutive digits anywhere in the line.
    const numMatch = line1.match(/\d{9}/)
    if (numMatch) cedula = numMatch[0]
  }

  // Line 2: dates + nationality
  const line2 = mrzLines[1] || ''
  let fechaNacimiento = ''
  let fechaVencimiento = ''
  let nacionalidad = ''
  let sexo = ''

  // DOB is first 6 digits: YYMMDD
  const dobMatch = line2.match(/^(\d{6})/)
  if (dobMatch) {
    const dob = dobMatch[1]
    const year = parseInt(dob.substring(0, 2), 10)
    const fullYear = year > 50 ? 1900 + year : 2000 + year
    fechaNacimiento = `${dob.substring(4, 6)}/${dob.substring(2, 4)}/${fullYear}`
  }

  // Sex: M or F after DOB check digit
  const sexMatch = line2.match(/\d{7}([MF<])/)
  if (sexMatch) {
    sexo = sexMatch[1] === '<' ? '' : sexMatch[1]
  }

  // Expiry: next 6 digits after sex
  const expiryMatch = line2.match(/[MF<](\d{6})/)
  if (expiryMatch) {
    const exp = expiryMatch[1]
    const year = parseInt(exp.substring(0, 2), 10)
    const fullYear = 2000 + year
    fechaVencimiento = `${exp.substring(4, 6)}/${exp.substring(2, 4)}/${fullYear}`
  }

  // Nationality
  const natMatch = line2.match(/CRI/)
  if (natMatch) nacionalidad = 'CRI'

  // Line 3: APELLIDO1<APELLIDO2<<NOMBRE1<NOMBRE2
  const line3 = mrzLines[2] || ''
  let nombre = ''
  let apellido1 = ''
  let apellido2 = ''

  // Split on << (separator between apellidos and nombres)
  const nameParts = line3.split(/<<+/)
  if (nameParts.length >= 2) {
    // First part: APELLIDO1<APELLIDO2
    const apellidos = nameParts[0].split('<').filter(Boolean)
    apellido1 = apellidos[0] || ''
    apellido2 = apellidos[1] || ''

    // Second part: NOMBRE1<NOMBRE2
    nombre = nameParts.slice(1).join(' ').replace(/</g, ' ').trim()
  }

  const success = cedula.length === 9 && apellido1.length > 0

  return {
    success,
    cedula,
    nombre,
    apellido1,
    apellido2,
    fechaNacimiento,
    fechaVencimiento,
    nacionalidad,
    sexo,
    rawMRZ: mrzLines,
    confidence,
  }
}

// ── Auto-crop: detect card rectangle and crop out background ──

/**
 * Auto-crop a card from a photo by finding the largest bright rectangle.
 * Uses edge detection to find the card boundaries.
 */
export function autoCropCard(imageSource: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const { data, width, height } = imageData

      // Find bounding box of the card by scanning for bright region
      // Card is lighter than dark background (table, desk)
      let minX = width, maxX = 0, minY = height, maxY = 0
      const threshold = 100 // brightness threshold

      // Sample every 4th pixel for speed
      for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
          const i = (y * width + x) * 4
          const brightness = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
          if (brightness > threshold) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }

      // Add small padding
      const pad = 8
      minX = Math.max(0, minX - pad)
      minY = Math.max(0, minY - pad)
      maxX = Math.min(width, maxX + pad)
      maxY = Math.min(height, maxY + pad)

      const cropW = maxX - minX
      const cropH = maxY - minY

      // Only crop if we found a reasonable card-shaped region
      // Card aspect ratio is ~1.586 (credit card / ID)
      const aspect = cropW / cropH
      if (cropW > width * 0.3 && cropH > height * 0.3 && aspect > 1.0 && aspect < 2.5) {
        const out = document.createElement('canvas')
        out.width = cropW
        out.height = cropH
        const outCtx = out.getContext('2d')!
        outCtx.drawImage(img, minX, minY, cropW, cropH, 0, 0, cropW, cropH)
        resolve(out.toDataURL('image/jpeg', 0.9))
      } else {
        // Crop failed — return original
        resolve(imageSource)
      }
    }
    img.onerror = () => resolve(imageSource)
    img.src = imageSource
  })
}

// ── Document analysis: format detection + damage assessment ──

/**
 * Analyze document images to detect format (old vs new) and damage.
 */
export async function analyzeDocument(
  frontImage: string | null,
  backImage: string | null,
): Promise<DocumentAnalysis> {
  const result: DocumentAnalysis = {
    format: 'unknown',
    damaged: false,
    damageNotes: [],
    croppedFront: null,
    croppedBack: null,
  }

  // Auto-crop both images
  if (frontImage) {
    result.croppedFront = await autoCropCard(frontImage)
  }
  if (backImage) {
    result.croppedBack = await autoCropCard(backImage)
  }

  // Analyze the back image for format detection
  if (backImage) {
    const analysis = await analyzeBackImage(backImage)
    result.format = analysis.format
    if (analysis.damageNotes.length > 0) {
      result.damaged = true
      result.damageNotes.push(...analysis.damageNotes)
    }
  }

  // Analyze front for damage
  if (frontImage) {
    const frontDamage = await assessDamage(frontImage)
    if (frontDamage.length > 0) {
      result.damaged = true
      result.damageNotes.push(...frontDamage)
    }
  }

  return result
}

/** Check back image for MRZ lines (new format) or barcode (old format).
 *  Tries all 4 rotations of the image — users frequently capture the back
 *  upside-down or sideways, and a fixed bottom-strip crop misses the MRZ
 *  in those cases.
 */
async function analyzeBackImage(imageSource: string): Promise<{
  format: 'new' | 'old' | 'unknown'
  damageNotes: string[]
}> {
  const damageNotes: string[] = []

  try {
    let bestChevrons = 0
    let bestText = ''

    for (const rotation of [0, 90, 180, 270] as const) {
      const rotated = rotation === 0 ? imageSource : await rotateImage(imageSource, rotation)
      // Run OCR on the FULL image — cropping a fixed region misses MRZ when
      // the user captured the back at any angle.
      const result = await Tesseract.recognize(rotated, 'eng')
      const text = result.data.text
      const chevronCount = (text.match(/</g) || []).length
      if (chevronCount > bestChevrons) {
        bestChevrons = chevronCount
        bestText = text
      }
      // Early exit if we already found a strong MRZ signal.
      if (chevronCount > 15) break
    }

    // MRZ markers — relaxed: 'IDCR' catches both 'IDCRI' (letter I) and
    // 'IDCR1' (digit 1, what tesseract usually reads).
    const hasMRZ = bestText.includes('<') && bestText.includes('IDCR')
    if (hasMRZ || bestChevrons > 10) {
      return { format: 'new', damageNotes }
    }

    return { format: 'old', damageNotes }
  } catch {
    return { format: 'unknown', damageNotes }
  }
}

/** Rotate an image by 90/180/270 degrees, returning a data URL. */
function rotateImage(imageSource: string, degrees: 90 | 180 | 270): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const rad = (degrees * Math.PI) / 180
      if (degrees === 180) {
        canvas.width = img.width
        canvas.height = img.height
      } else {
        canvas.width = img.height
        canvas.height = img.width
      }
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(rad)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => reject(new Error('rotateImage: load failed'))
    img.src = imageSource
  })
}

/** Assess document damage from image quality */
async function assessDamage(imageSource: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      // Downscale for fast analysis
      const scale = 200 / Math.max(img.width, img.height)
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const { data } = imageData
      const notes: string[] = []

      // Check overall brightness
      let totalBrightness = 0
      let darkPixels = 0
      let veryBrightPixels = 0
      const pixelCount = data.length / 4

      for (let i = 0; i < data.length; i += 4) {
        const b = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        totalBrightness += b
        if (b < 40) darkPixels++
        if (b > 240) veryBrightPixels++
      }

      const avgBrightness = totalBrightness / pixelCount

      // Yellow/brown tint = aging/damage
      let yellowPixels = 0
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2]
        if (r > 150 && g > 120 && b < 100 && r - b > 60) yellowPixels++
      }

      if (yellowPixels / pixelCount > 0.15) {
        notes.push('Documento con decoloración — posible deterioro por uso')
      }
      if (avgBrightness < 80) {
        notes.push('Imagen muy oscura — puede afectar la lectura')
      }
      if (veryBrightPixels / pixelCount > 0.3) {
        notes.push('Reflejo detectado — puede ocultar datos')
      }

      resolve(notes)
    }
    img.onerror = () => resolve([])
    img.src = imageSource
  })
}

// ── Front-side OCR for old format cédula ──

/**
 * Run general OCR on a cédula image (front or back of old format).
 * Tries to extract cédula number, name, and apellidos from printed text.
 */
async function runGeneralOCR(
  imageSource: string,
  label: string,
  onProgress?: (progress: number) => void,
): Promise<{ text: string; lines: string[]; confidence: number }> {
  const worker = await Tesseract.createWorker('spa', undefined, {
    logger: (m: any) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100))
      }
    },
  })

  const result = await worker.recognize(imageSource)
  await worker.terminate()

  const text = result.data.text
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  console.log(`[${label}] Full text:`, text)

  return { text, lines, confidence: result.data.confidence }
}

/** Extract cédula number from OCR lines */
function findCedulaNumber(lines: string[]): string {
  // First pass: look for labeled "Numero de Cedula:" line (old format back)
  for (const line of lines) {
    const lower = line.toLowerCase().replace(/[éè]/g, 'e').replace(/[úù]/g, 'u')
    if (lower.includes('cedula') || lower.includes('numero')) {
      // Extract digits after the label
      const afterLabel = line.replace(/^[^:]*:?\s*/, '')
      const digits = afterLabel.replace(/[\s.\-]/g, '').replace(/[^0-9]/g, '')
      if (digits.length === 9) return digits
    }
  }

  // Second pass: any line with 9-digit cédula pattern
  for (const line of lines) {
    // Pattern: "1 1129 0877" or "1-1129-0877" or "11129 0877" or "1 11290877"
    const numMatch = line.match(/(\d[\s.-]?\d{3,4}[\s.-]?\d{3,4})/)
    if (numMatch) {
      const digits = numMatch[1].replace(/[\s.\-]/g, '')
      if (digits.length === 9) return digits
    }
    // Also try bare 9-digit sequence
    const bareMatch = line.match(/\b(\d{9})\b/)
    if (bareMatch) return bareMatch[1]
  }
  return ''
}

/** Extract name fields from OCR lines using label matching */
function findNameFields(lines: string[]): { nombre: string; apellido1: string; apellido2: string } {
  let nombre = ''
  let apellido1 = ''
  let apellido2 = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lower = line.toLowerCase()
      .replace(/[áà]/g, 'a').replace(/[éè]/g, 'e')
      .replace(/[íì]/g, 'i').replace(/[óò]/g, 'o').replace(/[úù]/g, 'u')

    const cleanLabel = (val: string): string => {
      // Remove common label words that OCR might merge with the value
      return val
        .replace(/\b(nombre|apellido|primer[oa]?|segundo|cedula|c[\s.]?c[\s.]?)\b/gi, '')
        .replace(/[1-2][°*º]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
    }

    const extractValue = (l: string, nextLine?: string): string => {
      // Try after colon/semicolon on same line
      const afterColon = l.split(/[:;.]/)[1]?.trim()
      if (afterColon && afterColon.length > 1) {
        return cleanLabel(afterColon.replace(/[^A-ZÁÉÍÓÚÑa-záéíóúñ\s]/g, '').trim())
      }
      // Try next line
      if (nextLine) {
        return cleanLabel(nextLine.replace(/[^A-ZÁÉÍÓÚÑa-záéíóúñ\s]/g, '').trim())
      }
      return ''
    }

    // "Nombre:" — but NOT "Nombre del Padre/Madre"
    if (!nombre && lower.includes('nombre') && !lower.includes('padre') && !lower.includes('madre') && !lower.includes('apellido')) {
      nombre = extractValue(line, lines[i + 1])
    }

    // "1° Apellido" / "1er Apellido" / "Primer Apellido" / "1*Apellido"
    if (!apellido1 && lower.includes('apellido') && (lower.includes('1') || lower.includes('primer'))) {
      apellido1 = extractValue(line, lines[i + 1])
    }

    // "2° Apellido" / "Segundo Apellido" / "2*Apellido"
    if (!apellido2 && lower.includes('apellido') && (lower.includes('2') || lower.includes('segundo'))) {
      apellido2 = extractValue(line, lines[i + 1])
    }
  }

  return { nombre, apellido1, apellido2 }
}

/** Extract DOB from old-format back: "Fecha de Nacimiento: 20 02 1988" */
function findFechaNacimiento(lines: string[]): string {
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.includes('nacimiento') || lower.includes('nac')) {
      const dateMatch = line.match(/(\d{1,2})[\s/.-](\d{1,2})[\s/.-](\d{4})/)
      if (dateMatch) {
        return `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3]}`
      }
    }
  }
  return ''
}

/** Extract vencimiento from old-format back: "Vencimiento: 06 02 2034" */
function findVencimiento(lines: string[]): string {
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower.includes('vencimiento') || lower.includes('venc')) {
      const dateMatch = line.match(/(\d{1,2})[\s/.-](\d{1,2})[\s/.-](\d{4})/)
      if (dateMatch) {
        return `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')}/${dateMatch[3]}`
      }
    }
  }
  return ''
}

/**
 * Enhanced contrast preprocessing for dark images.
 * Applies adaptive contrast stretch before OCR.
 */
function enhanceContrast(imageSource: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data

      // Find min/max brightness for contrast stretch
      let minB = 255, maxB = 0
      for (let i = 0; i < data.length; i += 4) {
        const b = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        if (b < minB) minB = b
        if (b > maxB) maxB = b
      }

      // Stretch contrast
      const range = maxB - minB || 1
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          data[i + c] = Math.min(255, Math.max(0, ((data[i + c] - minB) / range) * 255))
        }
      }

      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.9))
    }
    img.onerror = () => resolve(imageSource)
    img.src = imageSource
  })
}

/**
 * Extract data from old-format cédula by OCR on both front and back.
 * Front: has cédula number, photo, name labels
 * Back: has "Numero de Unico", "Fecha de Nacimiento", parents' names
 */
export async function extractFromFront(
  frontImage: string,
  onProgress?: (progress: number) => void,
  backImage?: string | null,
): Promise<MRZResult> {
  const empty: MRZResult = {
    success: false,
    cedula: '', nombre: '', apellido1: '', apellido2: '',
    fechaNacimiento: '', fechaVencimiento: '',
    nacionalidad: 'CRI', sexo: '',
    rawMRZ: [], confidence: 0,
    source: 'front-ocr',
  }

  try {
    // Enhance contrast for dark images before OCR
    const enhancedFront = await enhanceContrast(frontImage)
    const enhancedBack = backImage ? await enhanceContrast(backImage) : null

    // Try front first
    const front = await runGeneralOCR(enhancedFront, 'front-ocr', onProgress)

    let cedula = findCedulaNumber(front.lines)
    let { nombre, apellido1, apellido2 } = findNameFields(front.lines)
    let fechaNacimiento = ''
    let fechaVencimiento = ''
    let confidence = front.confidence

    // Always try the back for old format — it has labeled fields
    if (enhancedBack) {
      const back = await runGeneralOCR(enhancedBack, 'back-ocr', (p) => onProgress?.(50 + p / 2))
      confidence = Math.max(confidence, back.confidence)

      // Back has "Numero de Cedula: 1 1129 0877" — more reliable than front
      if (!cedula) cedula = findCedulaNumber(back.lines)
      if (!nombre || !apellido1) {
        const backNames = findNameFields(back.lines)
        if (!nombre && backNames.nombre) nombre = backNames.nombre
        if (!apellido1 && backNames.apellido1) apellido1 = backNames.apellido1
        if (!apellido2 && backNames.apellido2) apellido2 = backNames.apellido2
      }
      fechaNacimiento = findFechaNacimiento(back.lines)
      fechaVencimiento = findVencimiento(back.lines)
    }

    // For old format: cédula alone is enough to proceed (user can fill name manually)
    const success = cedula.length === 9

    return {
      success,
      cedula,
      nombre,
      apellido1,
      apellido2,
      fechaNacimiento,
      fechaVencimiento,
      nacionalidad: 'CRI',
      sexo: '',
      rawMRZ: front.lines.slice(0, 5),
      confidence,
      source: 'front-ocr',
    }
  } catch (err) {
    console.error('[front-ocr] OCR failed:', err)
    return empty
  }
}
