import { ref } from 'vue'

/**
 * User avatar — a downscaled selfie data URL stored in localStorage and shared
 * across the topbar, account card, and dropdown.
 *
 * Stored as a tiny JPEG (target ~96px square) so the localStorage footprint
 * stays small and renders are instant.
 */
const STORAGE_KEY = 'attestto-avatar'

export const userAvatar = ref<string | null>(localStorage.getItem(STORAGE_KEY))

/**
 * Capture the user's selfie thumbnail. Pass any data URL of a face crop or
 * full selfie — this function downscales to 96px and stores it.
 */
export async function setUserAvatar(sourceDataUrl: string): Promise<void> {
  try {
    const thumb = await downscale(sourceDataUrl, 96)
    localStorage.setItem(STORAGE_KEY, thumb)
    userAvatar.value = thumb
  } catch (err) {
    console.warn('[avatar] failed to set:', err)
  }
}

export function clearUserAvatar(): void {
  localStorage.removeItem(STORAGE_KEY)
  userAvatar.value = null
}

function downscale(dataUrl: string, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      // Square center crop, then scale
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      canvas.width = maxSize
      canvas.height = maxSize
      ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('avatar source load failed'))
    img.src = dataUrl
  })
}
