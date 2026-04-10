<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useCamera } from '@/composables/useCamera'

const camera = useCamera()

const examState = ref<'ready' | 'in-progress' | 'result'>('ready')
const currentQuestion = ref(0)
const timeRemaining = ref(40 * 60)
const answers = ref<Record<number, string>>({})
let timerInterval: ReturnType<typeof setInterval> | null = null

const formattedTime = computed(() => {
  const mins = Math.floor(timeRemaining.value / 60)
  const secs = timeRemaining.value % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
})

// Demo questions (3 for quick demo — real bank is 40 from COSEVI)
const questions = [
  {
    id: 1,
    text: '¿Cual es la ley que rige actualmente el transito en Costa Rica?',
    options: [
      { value: 'a', label: 'Ley 7331' },
      { value: 'b', label: 'Ley 6324' },
      { value: 'c', label: 'Ley 9078' },
    ],
    correct: 'c',
  },
  {
    id: 2,
    text: '¿Cual es la velocidad maxima permitida en una rotonda?',
    options: [
      { value: 'a', label: '20 km/h' },
      { value: 'b', label: '30 km/h' },
      { value: 'c', label: '40 km/h' },
    ],
    correct: 'b',
  },
  {
    id: 3,
    text: '¿Que significa una linea amarilla continua en el centro de la via?',
    options: [
      { value: 'a', label: 'Se puede adelantar con precaucion' },
      { value: 'b', label: 'Prohibido adelantar' },
      { value: 'c', label: 'Carril exclusivo para buses' },
    ],
    correct: 'b',
  },
  {
    id: 4,
    text: '¿Que instrumento mide las revoluciones por minuto del motor?',
    options: [
      { value: 'a', label: 'Odometro' },
      { value: 'b', label: 'Velocimetro' },
      { value: 'c', label: 'Tacometro' },
    ],
    correct: 'c',
  },
  {
    id: 5,
    text: '¿Cual es el efecto del alcohol en la conduccion?',
    options: [
      { value: 'a', label: 'Aumenta la capacidad visual' },
      { value: 'b', label: 'Aumenta la maniobrabilidad' },
      { value: 'c', label: 'Aumenta el tiempo de reaccion y genera falsa euforia' },
    ],
    correct: 'c',
  },
  {
    id: 6,
    text: '¿Donde debe colocarse el cinturon de seguridad una mujer embarazada?',
    options: [
      { value: 'a', label: 'Sobre el pecho, debajo del vientre' },
      { value: 'b', label: 'Debajo del pecho, sobre el vientre' },
      { value: 'c', label: 'Debajo del pecho, debajo del vientre' },
    ],
    correct: 'a',
  },
  {
    id: 7,
    text: '¿Cual es la causa principal de colision frontal?',
    options: [
      { value: 'a', label: 'Distancia de seguimiento inadecuada' },
      { value: 'b', label: 'Invasion del carril izquierdo' },
      { value: 'c', label: 'Velocidad en giro a la derecha' },
    ],
    correct: 'b',
  },
  {
    id: 8,
    text: '¿Que factores afectan el tiempo de reaccion del conductor?',
    options: [
      { value: 'a', label: 'Condiciones de la via' },
      { value: 'b', label: 'Estado fisico y mental del conductor' },
      { value: 'c', label: 'Velocidad del vehiculo' },
    ],
    correct: 'b',
  },
  {
    id: 9,
    text: '¿Que debe portar un peaton de noche cerca de la via?',
    options: [
      { value: 'a', label: 'Caminar por el lado derecho' },
      { value: 'b', label: 'Linterna o material reflectivo' },
      { value: 'c', label: 'Permanecer cerca de la calzada' },
    ],
    correct: 'b',
  },
  {
    id: 10,
    text: '¿Que tipo de curvas existen?',
    options: [
      { value: 'a', label: 'Cerradas y abiertas' },
      { value: 'b', label: 'Suaves y pronunciadas' },
      { value: 'c', label: 'Horizontales y verticales' },
    ],
    correct: 'c',
  },
]

const currentQ = computed(() => questions[currentQuestion.value])
const progress = computed(() => ((currentQuestion.value + 1) / questions.length) * 100)

const score = computed(() => {
  let correct = 0
  for (let i = 0; i < questions.length; i++) {
    if (answers.value[i] === questions[i].correct) correct++
  }
  return correct
})

const passed = computed(() => score.value >= Math.ceil(questions.length * 0.8))

// Camera status for verification checklist
const cameraReady = computed(() => camera.isActive.value)

async function startExam() {
  if (!camera.isActive.value) {
    await camera.start()
  }
  examState.value = 'in-progress'
  startTimer()
}

function startTimer() {
  timerInterval = setInterval(() => {
    if (timeRemaining.value > 0) {
      timeRemaining.value--
    } else {
      submitExam()
    }
  }, 1000)
}

function submitExam() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  examState.value = 'result'
  // Camera stays on until result is shown, then stops
  setTimeout(() => camera.stop(), 2000)
}

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval)
  camera.stop()
})

// Auto-start camera on mount for preview
camera.start()
</script>

<template>
  <q-page style="padding: 2.5rem;">
    <!-- Ready State -->
    <template v-if="examState === 'ready'">
      <div class="text-h4 text-weight-bold q-mb-sm">Prueba Teorica de Manejo</div>
      <div class="att-text-body q-mb-xl">COSEVI / Direccion General de Educacion Vial — Ley 9078</div>

      <div class="row q-col-gutter-lg">
        <div class="col-12 col-md-8">
          <q-card flat bordered class="bg-dark">
            <q-card-section>
              <div class="text-h6 q-mb-md">Instrucciones</div>
              <q-list dense>
                <q-item v-for="(item, i) in [
                  'La prueba consta de 40 preguntas de seleccion unica (demo: 10)',
                  'Tiene 40 minutos para completar el examen',
                  'Necesita 80% (32/40) para aprobar',
                  'La camara debe permanecer activa durante todo el examen',
                  'No puede cambiar de ventana o abrir otras aplicaciones',
                  'Cada intento queda registrado con sello criptografico',
                ]" :key="i">
                  <q-item-section avatar>
                    <q-icon name="check" color="primary" size="sm" />
                  </q-item-section>
                  <q-item-section>{{ item }}</q-item-section>
                </q-item>
              </q-list>
            </q-card-section>

            <q-separator />

            <q-card-section>
              <div class="row q-col-gutter-md">
                <div class="col-4 text-center">
                  <div class="text-h4 text-primary">40</div>
                  <div class="text-caption att-text-body">Preguntas</div>
                </div>
                <div class="col-4 text-center">
                  <div class="text-h4 text-primary">40</div>
                  <div class="text-caption att-text-body">Minutos</div>
                </div>
                <div class="col-4 text-center">
                  <div class="text-h4 text-primary">80%</div>
                  <div class="text-caption att-text-body">Para aprobar</div>
                </div>
              </div>
            </q-card-section>

            <q-card-actions align="right" class="q-pa-md">
              <q-btn
                color="primary"
                size="lg"
                label="Iniciar Examen"
                icon="play_arrow"
                :disable="!cameraReady"
                @click="startExam"
              />
            </q-card-actions>
          </q-card>
        </div>

        <div class="col-12 col-md-4">
          <!-- Verification checklist -->
          <q-card flat bordered class="bg-dark">
            <q-card-section>
              <div class="text-subtitle1 text-weight-bold q-mb-md">Verificacion Previa</div>
              <q-list dense>
                <q-item>
                  <q-item-section avatar><q-icon name="circle" size="12px" color="positive" /></q-item-section>
                  <q-item-section>Identidad verificada</q-item-section>
                </q-item>
                <q-item>
                  <q-item-section avatar>
                    <q-icon name="circle" size="12px" :color="cameraReady ? 'positive' : 'negative'" />
                  </q-item-section>
                  <q-item-section>
                    {{ cameraReady ? 'Camara activa' : (camera.error.value || 'Conectando camara...') }}
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section avatar><q-icon name="circle" size="12px" :color="cameraReady ? 'positive' : 'grey-6'" /></q-item-section>
                  <q-item-section>Liveness verificado</q-item-section>
                </q-item>
                <q-item>
                  <q-item-section avatar><q-icon name="circle" size="12px" color="warning" /></q-item-section>
                  <q-item-section>Pago pendiente (₡5,000)</q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>

          <!-- Live camera preview -->
          <q-card flat bordered class="bg-dark q-mt-md">
            <q-card-section class="q-pa-none">
              <div class="camera-feed" style="aspect-ratio: 4/3;">
                <video
                  v-if="camera.isActive.value"
                  :ref="(el) => camera.bindVideo(el as HTMLVideoElement)"
                  autoplay
                  muted
                  playsinline
                />
                <div v-else class="flex flex-center" style="height: 200px;">
                  <div class="text-center">
                    <q-spinner-orbit v-if="!camera.error.value" size="32px" color="primary" />
                    <q-icon v-else name="videocam_off" size="48px" color="negative" />
                    <div class="text-caption att-text-muted q-mt-sm">
                      {{ camera.error.value || 'Iniciando camara...' }}
                    </div>
                  </div>
                </div>
              </div>
            </q-card-section>
            <q-card-section class="q-py-sm">
              <div class="text-caption att-text-body text-center">
                <q-icon :name="cameraReady ? 'circle' : 'circle'" size="8px" :color="cameraReady ? 'positive' : 'grey-6'" class="q-mr-xs" />
                {{ cameraReady ? 'Vista previa activa' : 'Sin camara' }}
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </template>

    <!-- In Progress -->
    <template v-if="examState === 'in-progress'">
      <div class="row q-col-gutter-lg">
        <!-- Question Area -->
        <div class="col-12 col-md-8">
          <!-- Progress bar -->
          <div class="row items-center q-mb-md">
            <div class="col">
              <q-linear-progress :value="progress / 100" color="primary" size="8px" rounded class="q-mr-md" />
            </div>
            <div class="att-text-body text-caption">
              {{ currentQuestion + 1 }} / {{ questions.length }}
            </div>
          </div>

          <q-card flat bordered class="bg-dark">
            <q-card-section>
              <div class="text-overline text-primary q-mb-sm">Pregunta {{ currentQuestion + 1 }}</div>
              <div class="text-h6 q-mb-lg">{{ currentQ.text }}</div>

              <q-option-group
                v-model="answers[currentQuestion]"
                :options="currentQ.options"
                color="primary"
                type="radio"
              />
            </q-card-section>

            <q-separator />

            <q-card-actions class="q-pa-md">
              <q-btn
                flat
                label="Anterior"
                icon="arrow_back"
                :disable="currentQuestion === 0"
                @click="currentQuestion--"
              />
              <q-space />
              <q-btn
                v-if="currentQuestion < questions.length - 1"
                color="primary"
                label="Siguiente"
                icon-right="arrow_forward"
                @click="currentQuestion++"
              />
              <q-btn
                v-else
                color="positive"
                label="Enviar Examen"
                icon="send"
                @click="submitExam"
              />
            </q-card-actions>
          </q-card>
        </div>

        <!-- Sidebar: Timer + Camera + Proctoring -->
        <div class="col-12 col-md-4">
          <!-- Timer -->
          <q-card flat bordered class="bg-dark q-mb-md">
            <q-card-section class="text-center">
              <div class="text-h3 text-weight-bold" :class="timeRemaining < 300 ? 'text-negative' : 'text-primary'">
                {{ formattedTime }}
              </div>
              <div class="text-caption att-text-body">Tiempo restante</div>
            </q-card-section>
          </q-card>

          <!-- Live camera feed -->
          <q-card flat bordered class="bg-dark q-mb-md">
            <q-card-section class="q-pa-none">
              <div class="camera-feed" style="aspect-ratio: 4/3;">
                <video
                  v-if="camera.isActive.value"
                  :ref="(el) => camera.bindVideo(el as HTMLVideoElement)"
                  autoplay
                  muted
                  playsinline
                />
                <div v-else class="flex flex-center" style="height: 180px;">
                  <div class="text-center">
                    <q-icon name="videocam_off" size="32px" color="negative" />
                    <div class="text-caption text-negative q-mt-xs">Sin camara</div>
                  </div>
                </div>
              </div>
            </q-card-section>
            <q-card-section class="q-py-xs">
              <div class="text-caption text-center" :class="camera.isActive.value ? 'text-positive' : 'text-negative'">
                <q-icon name="fiber_manual_record" size="8px" class="q-mr-xs" />
                {{ camera.isActive.value ? 'Grabando' : 'Camara desconectada' }}
              </div>
            </q-card-section>
          </q-card>

          <!-- Proctoring Status -->
          <q-card flat bordered class="bg-dark">
            <q-card-section>
              <div class="text-caption text-weight-bold q-mb-sm">Proctoring</div>
              <q-list dense>
                <q-item dense>
                  <q-item-section avatar>
                    <q-icon name="circle" size="8px" :color="camera.isActive.value ? 'positive' : 'negative'" />
                  </q-item-section>
                  <q-item-section><span class="text-caption">{{ camera.isActive.value ? 'Rostro detectado' : 'Sin deteccion' }}</span></q-item-section>
                </q-item>
                <q-item dense>
                  <q-item-section avatar><q-icon name="circle" size="8px" color="positive" /></q-item-section>
                  <q-item-section><span class="text-caption">Pantalla bloqueada</span></q-item-section>
                </q-item>
                <q-item dense>
                  <q-item-section avatar><q-icon name="circle" size="8px" color="positive" /></q-item-section>
                  <q-item-section><span class="text-caption">Sin anomalias</span></q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>

          <!-- Question Navigator -->
          <q-card flat bordered class="bg-dark q-mt-md">
            <q-card-section>
              <div class="text-caption text-weight-bold q-mb-sm">Navegador</div>
              <div class="row q-gutter-xs">
                <q-btn
                  v-for="(_, i) in questions"
                  :key="i"
                  dense
                  :flat="i !== currentQuestion"
                  :color="answers[i] ? 'primary' : i === currentQuestion ? 'secondary' : 'grey-8'"
                  :label="String(i + 1)"
                  size="sm"
                  style="min-width: 32px;"
                  @click="currentQuestion = i"
                />
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </template>

    <!-- Result -->
    <template v-if="examState === 'result'">
      <div class="flex flex-center" style="min-height: 60vh;">
        <q-card flat bordered class="bg-dark" style="max-width: 500px; width: 100%;">
          <q-card-section class="text-center q-pa-xl">
            <q-icon :name="passed ? 'emoji_events' : 'cancel'" size="80px" :color="passed ? 'positive' : 'negative'" />
            <div class="text-h4 text-weight-bold q-mt-md">Examen Completado</div>
            <div class="att-text-body q-mt-sm q-mb-lg">Resultado procesado y registrado</div>

            <div class="row q-col-gutter-md q-mb-lg">
              <div class="col-4">
                <div class="text-h5" :class="passed ? 'text-positive' : 'text-negative'">{{ score }}/{{ questions.length }}</div>
                <div class="text-caption att-text-body">Correctas</div>
              </div>
              <div class="col-4">
                <div class="text-h5 text-primary">{{ Math.round((score / questions.length) * 100) }}%</div>
                <div class="text-caption att-text-body">Puntaje</div>
              </div>
              <div class="col-4">
                <div class="text-h5" :class="passed ? 'text-positive' : 'text-negative'">
                  {{ passed ? 'APROBADO' : 'REPROBADO' }}
                </div>
                <div class="text-caption att-text-body">Resultado</div>
              </div>
            </div>

            <q-separator class="q-mb-md" />

            <q-list dense class="text-left q-mb-md">
              <q-item>
                <q-item-section avatar><q-icon name="tag" size="sm" color="primary" /></q-item-section>
                <q-item-section>
                  <q-item-label caption>Hash de sesion</q-item-label>
                  <q-item-label class="text-caption att-text-mono">7f3a9c...e4b2d1</q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section avatar><q-icon name="link" size="sm" color="secondary" /></q-item-section>
                <q-item-section>
                  <q-item-label caption>Ancla Solana (PAdES-T)</q-item-label>
                  <q-item-label class="text-caption att-text-mono">tx:4k8f2a...c7e1b3</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="passed">
                <q-item-section avatar><q-icon name="verified" size="sm" color="positive" /></q-item-section>
                <q-item-section>
                  <q-item-label caption>Credencial emitida</q-item-label>
                  <q-item-label class="text-caption">Prueba Teorica Aprobada (VC)</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>

            <q-btn color="primary" :label="passed ? 'Ver Credencial' : 'Volver al inicio'" :icon="passed ? 'verified' : 'home'" @click="$router.push(passed ? '/credentials' : '/')" />
          </q-card-section>
        </q-card>
      </div>
    </template>
  </q-page>
</template>
