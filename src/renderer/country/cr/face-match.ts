// ── Face matching for cédula verification ──
// Uses @vladmandic/face-api (TF.js backend) to extract a 128D face descriptor
// from the cédula photo and the live selfie, then compares them by Euclidean
// distance. Lower distance = more similar; the standard threshold is 0.6.
//
// Models are served from `/face-models/` (vite publicDir) so they work in
// dev (vite dev server) and in the packaged app (copied to dist).
//
// All processing is 100% local — no network calls.

import * as faceapi from '@vladmandic/face-api'

const MODEL_URL = '/face-models'

/** Standard face-api distance threshold for "same person" decisions. */
export const FACE_MATCH_THRESHOLD = 0.6

let modelsLoaded = false
let modelsLoading: Promise<void> | null = null

/** Lazy-load the three models we need. Idempotent + concurrent-safe. */
export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return
  if (modelsLoading) return modelsLoading

  modelsLoading = (async () => {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    modelsLoaded = true
  })()

  try {
    await modelsLoading
  } finally {
    modelsLoading = null
  }
}

/**
 * Load an image (data URL or remote URL) into an HTMLImageElement.
 * face-api accepts HTMLImageElement directly.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for face detection'))
    img.src = src
  })
}

export interface FaceDescriptorResult {
  /** 128 floats — face embedding from faceRecognitionNet */
  descriptor: Float32Array
  /** Detection confidence from tinyFaceDetector (0..1) */
  detectionScore: number
  /** Bounding box of the detected face */
  box: { x: number; y: number; width: number; height: number }
}

/**
 * Detect the most prominent face in an image and return its 128D descriptor.
 * Returns null if no face is detected (e.g. cédula photo too small / blurry).
 */
export async function extractFaceDescriptor(
  imageSource: string,
): Promise<FaceDescriptorResult | null> {
  await loadFaceModels()
  const img = await loadImage(imageSource)

  const detection = await faceapi
    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!detection) return null

  return {
    descriptor: detection.descriptor,
    detectionScore: detection.detection.score,
    box: {
      x: detection.detection.box.x,
      y: detection.detection.box.y,
      width: detection.detection.box.width,
      height: detection.detection.box.height,
    },
  }
}

/**
 * Compare two face descriptors. Returns euclidean distance (0..~1.5) and a
 * convenience similarity score in [0, 1] where 1 = identical.
 *
 * The similarity is `max(0, 1 - distance / FACE_MATCH_THRESHOLD * 0.6)`
 * normalized so a distance of FACE_MATCH_THRESHOLD maps to ~0.4 (just below
 * "match"), and a distance of 0 maps to 1.0.
 */
export function compareDescriptors(
  a: Float32Array,
  b: Float32Array,
): { distance: number; similarity: number; match: boolean } {
  const distance = faceapi.euclideanDistance(a, b)
  // Linear mapping anchored at the threshold
  const similarity = Math.max(0, Math.min(1, 1 - distance / (FACE_MATCH_THRESHOLD * 1.5)))
  return {
    distance,
    similarity,
    match: distance < FACE_MATCH_THRESHOLD,
  }
}

/** SHA-256 hex of arbitrary bytes via Web Crypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so the type narrows from ArrayBufferLike
  // (which can be SharedArrayBuffer) to ArrayBuffer — required by lib.dom's
  // BufferSource signature under strict TS.
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Convert a 128D Float32Array descriptor to its raw 512-byte representation. */
export function descriptorToBytes(descriptor: Float32Array): Uint8Array {
  return new Uint8Array(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength)
}

/** Convert a base64 / data URL image into raw bytes. */
export async function dataUrlToBytes(dataUrl: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const arrayBuffer = await blob.arrayBuffer()
  return { bytes: new Uint8Array(arrayBuffer), mediaType: blob.type || 'application/octet-stream' }
}

/** Library version (for VerificationSession.model.version). */
export const FACE_API_MODEL_INFO = {
  name: '@vladmandic/face-api',
  // Pinned to whatever pnpm resolved; updated by hand if upgraded
  version: '1.7.15',
}
