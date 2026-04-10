import { ref, onUnmounted } from 'vue'

export function useCamera() {
  const stream = ref<MediaStream | null>(null)
  const isActive = ref(false)
  const error = ref<string | null>(null)
  const videoRef = ref<HTMLVideoElement | null>(null)
  const devices = ref<MediaDeviceInfo[]>([])

  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      devices.value = all.filter(d => d.kind === 'videoinput')
    } catch (e) {
      error.value = 'No se pudo listar dispositivos de video'
    }
  }

  async function start(deviceId?: string) {
    try {
      error.value = null
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
          : { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      }

      stream.value = await navigator.mediaDevices.getUserMedia(constraints)
      isActive.value = true

      // Don't play here — bindVideo handles it when Vue mounts the element.
      // If videoRef already exists (re-start), attach the stream.
      if (videoRef.value) {
        videoRef.value.srcObject = stream.value
        videoRef.value.play().catch(() => { /* bindVideo will retry */ })
      }
    } catch (e: unknown) {
      isActive.value = false
      if (e instanceof DOMException) {
        if (e.name === 'NotAllowedError') {
          error.value = 'Permiso de camara denegado'
        } else if (e.name === 'NotFoundError') {
          error.value = 'No se encontro camara'
        } else {
          error.value = `Error de camara: ${e.message}`
        }
      } else {
        error.value = 'Error desconocido al acceder a la camara'
      }
    }
  }

  function stop() {
    if (stream.value) {
      for (const track of stream.value.getTracks()) {
        track.stop()
      }
      stream.value = null
    }
    isActive.value = false
    if (videoRef.value) {
      videoRef.value.srcObject = null
    }
  }

  function bindVideo(el: HTMLVideoElement | null) {
    videoRef.value = el
    if (el && stream.value) {
      el.srcObject = stream.value
      el.play().catch(() => { /* may be interrupted by re-render, safe to ignore */ })
    }
  }

  onUnmounted(() => {
    stop()
  })

  return {
    stream,
    isActive,
    error,
    devices,
    videoRef,
    listDevices,
    start,
    stop,
    bindVideo,
  }
}
