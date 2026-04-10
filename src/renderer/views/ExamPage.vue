<script setup lang="ts">
import { useProctor } from '@/composables/useProctor'

const proctor = useProctor()
</script>

<template>
  <q-page style="padding: 2.5rem;">
    <!-- Consent Screen (Ley 8968) -->
    <template v-if="proctor.phase.value === 'consent'">
      <div class="flex flex-center" style="min-height: 70vh;">
        <q-card flat bordered class="bg-dark" style="max-width: 640px; width: 100%;">
          <q-card-section class="q-pa-lg">
            <div class="row items-center q-mb-md">
              <q-icon name="gavel" size="28px" color="primary" class="q-mr-sm" />
              <div class="text-h5 text-weight-bold">Consentimiento Informado</div>
            </div>

            <div class="text-body2 q-mb-md" style="line-height: 1.6;">
              De conformidad con la <strong>Ley N.° 8968</strong> de Protección de la Persona frente
              al Tratamiento de sus Datos Personales, se le informa que durante la
              aplicación de esta prueba teórica se recopilará la siguiente información:
            </div>

            <q-list dense class="q-mb-md">
              <q-item v-for="(item, i) in [
                'Captura periódica de fotografía facial para verificación de identidad',
                'Detección de presencia de rostro y múltiples personas',
                'Registro de eventos de la sesión (respuestas, navegación, tiempo)',
                'Telemetría del entorno de evaluación (enfoque de ventana, intentos de salida)',
                'Hash criptográfico de cada evento para integridad del expediente',
              ]" :key="i">
                <q-item-section avatar>
                  <q-icon name="info" size="sm" color="primary" />
                </q-item-section>
                <q-item-section class="text-body2">{{ item }}</q-item-section>
              </q-item>
            </q-list>

            <div class="text-body2 q-mb-md" style="line-height: 1.6;">
              Esta información se utilizará <strong>exclusivamente</strong> para verificar su identidad
              y garantizar la integridad de la evaluación. No se realizarán análisis secundarios
              ni se compartirá con terceros fuera del proceso evaluativo.
            </div>

            <div class="text-body2 q-mb-lg" style="line-height: 1.6;">
              Los datos serán conservados por el plazo definido por la Dirección General de
              Educación Vial y eliminados mediante procedimiento verificable conforme a la normativa.
            </div>

            <q-separator class="q-mb-md" />

            <div class="row items-center justify-between">
              <q-btn flat label="Rechazar" color="grey-6" @click="$router.push('/')" />
              <q-btn
                color="blue-6"
                text-color="white"
                unelevated
                label="Acepto — Continuar"
                icon="check"
                @click="proctor.acceptConsent()"
              />
            </div>
          </q-card-section>
        </q-card>
      </div>
    </template>

    <!-- Ready State -->
    <template v-if="proctor.phase.value === 'ready'">
      <div class="text-h4 text-weight-bold q-mb-sm">Prueba Teórica de Manejo</div>
      <div class="att-text-body q-mb-xl">COSEVI / Dirección General de Educación Vial — Ley 9078</div>

      <div v-if="proctor.error.value" class="q-mb-md">
        <q-banner class="bg-negative text-white" rounded>
          {{ proctor.error.value }}
        </q-banner>
      </div>

      <div class="row q-col-gutter-lg">
        <div class="col-12 col-md-8">
          <q-card flat bordered class="bg-dark">
            <q-card-section>
              <div class="text-h6 q-mb-md">Instrucciones</div>
              <q-list dense>
                <q-item v-for="(item, i) in [
                  'La prueba consta de 10 preguntas de selección única (banco completo: 40)',
                  'Tiene 40 minutos para completar el examen',
                  'Necesita 80% para aprobar',
                  'La cámara debe permanecer activa durante todo el examen',
                  'La pantalla entrará en modo de bloqueo — no podrá cambiar de ventana',
                  'Cada respuesta queda registrada con sello criptográfico',
                  'Intentos de salir del examen quedan registrados como incidentes',
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
                  <div class="text-h4 text-primary">10</div>
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
                color="blue-6"
                text-color="white"
                size="lg"
                label="Iniciar Examen"
                icon="play_arrow"
                unelevated
                :disable="!proctor.cameraReady.value"
                @click="proctor.startExam()"
              />
            </q-card-actions>
          </q-card>
        </div>

        <div class="col-12 col-md-4">
          <!-- Verification checklist -->
          <q-card flat bordered class="bg-dark">
            <q-card-section>
              <div class="text-subtitle1 text-weight-bold q-mb-md">Verificación Previa</div>
              <q-list dense>
                <q-item>
                  <q-item-section avatar><q-icon name="circle" size="12px" color="positive" /></q-item-section>
                  <q-item-section>Identidad verificada</q-item-section>
                </q-item>
                <q-item>
                  <q-item-section avatar>
                    <q-icon name="circle" size="12px" :color="proctor.cameraReady.value ? 'positive' : 'negative'" />
                  </q-item-section>
                  <q-item-section>
                    {{ proctor.cameraReady.value ? 'Cámara activa' : (proctor.camera.error.value || 'Conectando cámara...') }}
                  </q-item-section>
                </q-item>
                <q-item>
                  <q-item-section avatar><q-icon name="circle" size="12px" :color="proctor.cameraReady.value ? 'positive' : 'grey-6'" /></q-item-section>
                  <q-item-section>Modo bloqueo listo</q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>

          <!-- Live camera preview -->
          <q-card flat bordered class="bg-dark q-mt-md">
            <q-card-section class="q-pa-none">
              <div class="camera-feed" style="aspect-ratio: 4/3;">
                <video
                  v-if="proctor.camera.isActive.value"
                  :ref="(el) => proctor.bindVideoForDetection(el as HTMLVideoElement)"
                  autoplay
                  muted
                  playsinline
                />
                <div v-else class="flex flex-center" style="height: 200px;">
                  <div class="text-center">
                    <q-spinner-orbit v-if="!proctor.camera.error.value" size="32px" color="primary" />
                    <q-icon v-else name="videocam_off" size="48px" color="negative" />
                    <div class="text-caption att-text-muted q-mt-sm">
                      {{ proctor.camera.error.value || 'Iniciando cámara...' }}
                    </div>
                  </div>
                </div>
              </div>
            </q-card-section>
            <q-card-section class="q-py-sm">
              <div class="text-caption att-text-body text-center">
                <q-icon name="circle" size="8px" :color="proctor.cameraReady.value ? 'positive' : 'grey-6'" class="q-mr-xs" />
                {{ proctor.cameraReady.value ? 'Vista previa activa' : 'Sin cámara' }}
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </template>

    <!-- In Progress -->
    <template v-if="proctor.phase.value === 'in-progress' && proctor.currentQuestion.value">
      <div class="row q-col-gutter-lg">
        <!-- Question Area -->
        <div class="col-12 col-md-8">
          <!-- Progress bar -->
          <div class="row items-center q-mb-md">
            <div class="col">
              <q-linear-progress :value="proctor.progress.value / 100" color="primary" size="8px" rounded class="q-mr-md" />
            </div>
            <div class="att-text-body text-caption">
              {{ proctor.currentIndex.value + 1 }} / {{ proctor.totalQuestions.value }}
            </div>
          </div>

          <q-card flat bordered class="bg-dark">
            <q-card-section>
              <div class="text-overline text-primary q-mb-sm">Pregunta {{ proctor.currentIndex.value + 1 }}</div>
              <div class="text-h6 q-mb-lg">{{ proctor.currentQuestion.value.text }}</div>

              <q-option-group
                :model-value="proctor.answeredMap.value[proctor.currentIndex.value]"
                @update:model-value="proctor.selectAnswer($event)"
                :options="proctor.currentQuestion.value.options"
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
                :disable="proctor.currentIndex.value === 0"
                @click="proctor.prevQuestion()"
              />
              <q-space />
              <q-btn
                v-if="proctor.currentIndex.value < proctor.totalQuestions.value - 1"
                color="blue-6"
                text-color="white"
                unelevated
                label="Siguiente"
                icon-right="arrow_forward"
                @click="proctor.nextQuestion()"
              />
              <q-btn
                v-else
                color="positive"
                label="Enviar Examen"
                icon="send"
                @click="proctor.submitExam()"
              />
            </q-card-actions>
          </q-card>
        </div>

        <!-- Sidebar: Timer + Camera + Proctoring -->
        <div class="col-12 col-md-4">
          <!-- Timer -->
          <q-card flat bordered class="bg-dark q-mb-md">
            <q-card-section class="text-center">
              <div class="text-h3 text-weight-bold" :class="proctor.timeRemaining.value < 300 ? 'text-negative' : 'text-primary'">
                {{ proctor.formattedTime.value }}
              </div>
              <div class="text-caption att-text-body">Tiempo restante</div>
            </q-card-section>
          </q-card>

          <!-- Live camera feed -->
          <q-card flat bordered class="bg-dark q-mb-md">
            <q-card-section class="q-pa-none">
              <div class="camera-feed" style="aspect-ratio: 4/3;">
                <video
                  v-if="proctor.camera.isActive.value"
                  :ref="(el) => proctor.bindVideoForDetection(el as HTMLVideoElement)"
                  autoplay
                  muted
                  playsinline
                />
                <div v-else class="flex flex-center" style="height: 180px;">
                  <div class="text-center">
                    <q-icon name="videocam_off" size="32px" color="negative" />
                    <div class="text-caption text-negative q-mt-xs">Sin cámara</div>
                  </div>
                </div>
              </div>
            </q-card-section>
            <q-card-section class="q-py-xs">
              <div class="text-caption text-center" :class="proctor.camera.isActive.value ? 'text-positive' : 'text-negative'">
                <q-icon name="fiber_manual_record" size="8px" class="q-mr-xs" />
                {{ proctor.camera.isActive.value ? 'Grabando' : 'Cámara desconectada' }}
              </div>
            </q-card-section>
          </q-card>

          <!-- Proctoring Status -->
          <q-card flat bordered class="bg-dark">
            <q-card-section>
              <div class="text-caption text-weight-bold q-mb-sm">Supervisión</div>
              <q-list dense>
                <!-- Face detection -->
                <q-item dense>
                  <q-item-section avatar>
                    <q-icon name="circle" size="8px" :color="
                      proctor.faceDetection.status.value === 'present' ? 'positive' :
                      proctor.faceDetection.status.value === 'multiple' ? 'negative' :
                      proctor.faceDetection.status.value === 'absent' ? 'warning' :
                      'grey-6'
                    " />
                  </q-item-section>
                  <q-item-section>
                    <span class="text-caption" :class="{
                      'text-warning': proctor.faceDetection.status.value === 'absent',
                      'text-negative': proctor.faceDetection.status.value === 'multiple',
                    }">
                      {{
                        proctor.faceDetection.status.value === 'present' ? 'Rostro detectado' :
                        proctor.faceDetection.status.value === 'absent' ? 'Sin rostro detectado' :
                        proctor.faceDetection.status.value === 'multiple' ? `${proctor.faceDetection.faceCount.value} rostros detectados` :
                        proctor.faceDetection.status.value === 'error' ? 'Error en detección' :
                        'Inicializando detección…'
                      }}
                    </span>
                  </q-item-section>
                </q-item>
                <!-- Camera -->
                <q-item dense>
                  <q-item-section avatar>
                    <q-icon name="circle" size="8px" :color="proctor.camera.isActive.value ? 'positive' : 'negative'" />
                  </q-item-section>
                  <q-item-section><span class="text-caption">Cámara {{ proctor.camera.isActive.value ? 'activa' : 'inactiva' }}</span></q-item-section>
                </q-item>
                <!-- Lockdown -->
                <q-item dense>
                  <q-item-section avatar>
                    <q-icon name="circle" size="8px" :color="proctor.lockdown.state.value.active ? 'positive' : 'grey-6'" />
                  </q-item-section>
                  <q-item-section><span class="text-caption">Pantalla bloqueada</span></q-item-section>
                </q-item>
                <!-- Focus -->
                <q-item dense>
                  <q-item-section avatar>
                    <q-icon name="circle" size="8px" :color="proctor.lockdown.state.value.focusLost ? 'negative' : 'positive'" />
                  </q-item-section>
                  <q-item-section>
                    <span class="text-caption">
                      {{ proctor.lockdown.state.value.focusLost ? 'Ventana sin foco' : 'Ventana enfocada' }}
                    </span>
                  </q-item-section>
                </q-item>
                <!-- Violations -->
                <q-item v-if="proctor.lockdown.state.value.violationCount > 0" dense>
                  <q-item-section avatar>
                    <q-icon name="circle" size="8px" color="warning" />
                  </q-item-section>
                  <q-item-section>
                    <span class="text-caption text-warning">
                      {{ proctor.lockdown.state.value.violationCount }} intento(s) bloqueado(s)
                    </span>
                  </q-item-section>
                </q-item>
                <!-- Frame hash -->
                <q-item v-if="proctor.faceDetection.lastFrameHash.value" dense>
                  <q-item-section avatar>
                    <q-icon name="circle" size="8px" color="primary" />
                  </q-item-section>
                  <q-item-section>
                    <span class="text-caption att-text-mono">
                      Frame: {{ proctor.faceDetection.lastFrameHash.value.slice(0, 12) }}…
                    </span>
                  </q-item-section>
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
                  v-for="i in proctor.totalQuestions.value"
                  :key="i"
                  dense
                  :flat="(i - 1) !== proctor.currentIndex.value"
                  :color="proctor.answeredMap.value[i - 1] ? 'primary' : (i - 1) === proctor.currentIndex.value ? 'secondary' : 'grey-8'"
                  :label="String(i)"
                  size="sm"
                  style="min-width: 32px;"
                  @click="proctor.goToQuestion(i - 1)"
                />
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </template>

    <!-- Submitting -->
    <template v-if="proctor.phase.value === 'submitting'">
      <div class="flex flex-center" style="min-height: 60vh;">
        <div class="text-center">
          <q-spinner-orbit size="64px" color="primary" />
          <div class="text-h6 q-mt-md">Procesando examen…</div>
          <div class="text-caption att-text-muted">Calculando resultado y generando prueba criptográfica</div>
        </div>
      </div>
    </template>

    <!-- Result -->
    <template v-if="proctor.phase.value === 'result' && proctor.result.value">
      <div class="flex flex-center" style="min-height: 60vh;">
        <q-card flat bordered class="bg-dark" style="max-width: 550px; width: 100%;">
          <q-card-section class="text-center q-pa-xl">
            <q-icon
              :name="proctor.result.value.passed ? 'emoji_events' : 'cancel'"
              size="80px"
              :color="proctor.result.value.passed ? 'positive' : 'negative'"
            />
            <div class="text-h4 text-weight-bold q-mt-md">Examen Completado</div>
            <div class="att-text-body q-mt-sm q-mb-lg">Resultado procesado y registrado</div>

            <div class="row q-col-gutter-md q-mb-lg">
              <div class="col-4">
                <div class="text-h5" :class="proctor.result.value.passed ? 'text-positive' : 'text-negative'">
                  {{ proctor.result.value.score }}/{{ proctor.result.value.totalQuestions }}
                </div>
                <div class="text-caption att-text-body">Correctas</div>
              </div>
              <div class="col-4">
                <div class="text-h5 text-primary">{{ proctor.result.value.percentage }}%</div>
                <div class="text-caption att-text-body">Puntaje</div>
              </div>
              <div class="col-4">
                <div class="text-h5" :class="proctor.result.value.passed ? 'text-positive' : 'text-negative'">
                  {{ proctor.result.value.passed ? 'APROBADO' : 'REPROBADO' }}
                </div>
                <div class="text-caption att-text-body">Resultado</div>
              </div>
            </div>

            <!-- Flags (if any) -->
            <div v-if="proctor.result.value.flags.length > 0" class="q-mb-md">
              <q-separator class="q-mb-md" />
              <div class="text-caption text-weight-bold text-left q-mb-sm">Incidentes registrados</div>
              <q-list dense class="text-left">
                <q-item v-for="(flag, i) in proctor.result.value.flags" :key="i" dense>
                  <q-item-section avatar>
                    <q-icon
                      name="warning"
                      size="sm"
                      :color="flag.severity === 'critical' ? 'negative' : flag.severity === 'warning' ? 'warning' : 'grey-6'"
                    />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label class="text-caption">{{ flag.description }}</q-item-label>
                    <q-item-label caption>{{ new Date(flag.timestamp).toLocaleTimeString() }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </div>

            <q-separator class="q-mb-md" />

            <!-- Session proof -->
            <q-list dense class="text-left q-mb-md">
              <q-item>
                <q-item-section avatar><q-icon name="tag" size="sm" color="primary" /></q-item-section>
                <q-item-section>
                  <q-item-label caption>Prueba de sesión (SHA-256)</q-item-label>
                  <q-item-label class="text-caption att-text-mono">{{ proctor.result.value.sessionProof.slice(0, 16) }}…{{ proctor.result.value.sessionProof.slice(-8) }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-item>
                <q-item-section avatar><q-icon name="timer" size="sm" color="secondary" /></q-item-section>
                <q-item-section>
                  <q-item-label caption>Duración</q-item-label>
                  <q-item-label class="text-caption">{{ Math.floor(proctor.result.value.durationSec / 60) }}m {{ proctor.result.value.durationSec % 60 }}s</q-item-label>
                </q-item-section>
              </q-item>
              <q-item v-if="proctor.result.value.needsReview">
                <q-item-section avatar><q-icon name="pending" size="sm" color="warning" /></q-item-section>
                <q-item-section>
                  <q-item-label caption>Estado</q-item-label>
                  <q-item-label class="text-caption text-warning">Pendiente de revisión por incidentes</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>

            <q-btn
              color="blue-6"
              text-color="white"
              unelevated
              :label="proctor.result.value.passed && !proctor.result.value.needsReview ? 'Ver Credencial' : 'Volver al inicio'"
              :icon="proctor.result.value.passed && !proctor.result.value.needsReview ? 'verified' : 'home'"
              @click="$router.push(proctor.result.value!.passed && !proctor.result.value!.needsReview ? '/credentials' : '/')"
            />
          </q-card-section>
        </q-card>
      </div>
    </template>
  </q-page>
</template>
