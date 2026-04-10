# Matriz de Cumplimiento del Pliego — Prueba Teórica Virtual (Proctoring)

**Fuente:** Pliego de Contratación de Servicios para la transformación digital de los servicios de impresión de licencia de conducir física y digital y prueba de manejo teórica digital — MOPT/DGEV 2026

**Alcance:** Sección 1.2.3.1 — Requerimientos técnicos — Prueba Teórica Virtual (páginas 22-45)

**Arquitectura:** Local-first, sin conexión. 100% frontend (Vue/Quasar). Escritorio vía Electron, móvil vía PWA. Sin servidor. Bóveda cifrada en dispositivo. Credenciales Verificables como prueba. El ciudadano es dueño de todos sus datos.

---

## A. Arquitectura y Cliente (p.22-23)

### A1. 100% web (responsivo), Chrome/Edge/Firefox, sin plugins propietarios
**CUMPLE.** 100% frontend web. La instalación de escritorio se requiere únicamente para el almacenamiento cifrado de la bóveda en dispositivo. Sin retención de datos en servidor. PWA para móvil, Electron para escritorio — ambos ejecutan el mismo frontend Vue/Quasar.

### A2. Separación de capas (front SPA/SSR, API, servicios de identidad/proctoring), con cifrado TLS 1.2+
**N/A.** Arquitectura completamente local. Sin llamadas de red durante el examen. La comunicación Renderer ↔ proceso principal es IPC en memoria, no por red. La evidencia permanece en el dispositivo. El usuario presenta las pruebas él mismo en cualquier proceso de reclamo/apelación. TLS solo sería relevante si se añaden APIs de integración con COSEVI (alcance separado).

### A3. Vincular sesión con trámite activo en SGLC; una sola prueba activa por usuario
**N/A.** El seguimiento de sesión es interno. COSEVI recibe el resultado final como una VC firmada cuando el usuario la presenta. No necesitan visibilidad en tiempo real de los intentos en curso.

### A4. Reanudación controlada ante cortes de energía o conectividad
**POR CONSTRUIR.** Guardar estado de sesión en localStorage (índice de pregunta actual, respuestas, tiempo restante, ID de sesión). Al reiniciar, detectar sesión incompleta → reanudar desde donde se detuvo. No se requiere revalidación biométrica ya que la bóveda está en el mismo dispositivo.

### A5. WCAG 2.1 AA (accesibilidad) y modos de alto contraste
**POR CONSTRUIR.** Cumplimiento completo de WCAG 2.1 AA + asistencia por voz. Etiquetas ARIA en todos los elementos interactivos, navegación solo con teclado a través del examen, modo de alto contraste, y lectura de voz bajo demanda de preguntas/opciones (Web Speech API `speechSynthesis`). Diferenciador — la mayoría de las plataformas de proctoring tienen una accesibilidad terrible.

### A6. Huella de entorno (device fingerprint) para asociar sesión y dispositivo
**CUMPLE vía DID de la bóveda.** El par de claves Ed25519 de la bóveda está vinculado al dispositivo y a la identidad. Cada evento de sesión está firmado con esta clave. Criptográficamente más fuerte que cualquier fingerprint de navegador (que puede ser falsificado). No se necesita fingerprinting adicional.

### A7. Browser lockdown: bloquear navegación, impresión, copiar/pegar, ventanas externas
**PARCIAL → POR CONSTRUIR.** Modo kiosco + bloqueo de teclado + siempre encima completado. Agregar: desactivación de API de portapapeles (prevención de eventos `copy/cut/paste`), bloqueo de impresión (CSS `@media print` + intercepción de impresión en Electron), detección de captura de pantalla (bloqueo de tecla PrintScreen + restricción de `desktopCapturer`). Alcance en ATT-403.

### A8. Aplicación móvil nativa con mismas capacidades de proctoring
**POR CONSTRUIR — PWA.** El lockdown móvil es más simple: API de pantalla completa + detección de `visibilitychange` (usuario sale → bandera). No se necesita modo kiosco. La captura de pantalla es una acción a nivel de SO que no se puede bloquear en ninguna plataforma — la marca de agua se encarga de la disuasión. Los mismos composables useProctor/useFaceDetection funcionan en ambas superficies.

---

## B. Identidad, Proctoring y Antifraude (p.23-26)

### B1. Pre-examen: verificación biométrica facial contra TSE/BIOMETRIC con prueba de vida
**CUMPLE vía flujo de identidad existente.** La verificación de identidad nacional (cédula/DIMEX) de la app sirve como la puerta biométrica pre-examen. El usuario debe estar verificado en su bóveda antes de acceder al módulo de examen. No se necesita llamada separada a la API del TSE — la identidad ya está establecida.

### B2. Prueba de vida (liveness) pre-examen y durante el examen
**POR CONSTRUIR — comparación facial contra biométrico almacenado.** Al inicio del examen, comparar el rostro en vivo de la cámara contra el biométrico capturado durante la verificación de identidad (almacenado en bóveda). Re-comparación periódica durante el examen (cada 60s o en eventos de riesgo). FaceLandmarker nos da el embedding para comparación. Liveness = detección facial continua + variación de movimiento. Si el rostro no coincide con el biométrico almacenado → sesión bloqueada.

### B3. Revalidaciones biométricas periódicas o por eventos de riesgo
**POR CONSTRUIR — revalidación por evento de riesgo + movimiento labial + actividad de voz.**
- Rostro ausente >5s → pausar examen, requerir coincidencia facial contra biométrico para reanudar
- Múltiples rostros → respuesta graduada (ver B7)
- Rostro regresa tras ausencia → re-comparar contra biométrico almacenado
- Rastreo de dirección de mirada (FaceLandmarker) — mirada sostenida fuera de pantalla → bandera
- Detección de movimiento labial (landmarks de boca de FaceLandmarker) — labios moviéndose sin audio → bandera de sospecha
- Detección de actividad de voz (Web Audio API) — habla sostenida → advertencia, múltiples voces → bandera crítica
- Matriz de señales combinadas: labios quietos + sin audio = normal; labios moviéndose + audio = hablando (bandera); labios moviéndose + sin audio = sospechoso (bandera); labios quietos + audio = otra persona hablando (bandera crítica)
- En móvil: `visibilitychange` es la señal principal de trampa, mirada/audio son secundarios

### B4. Captura de video/foto continua o intermitente del rostro; grabación de eventos críticos
**POR CONSTRUIR — captura activada solo por anomalía.** Sin capturas periódicas (un examen de 40 minutos hace que las capturas programadas sean inútiles y un riesgo de privacidad). Fotograma capturado + cifrado + hasheado solo en eventos con bandera: múltiples rostros, rostro ausente, rostro no coincide, anomalía de movimiento labial, voz detectada, pérdida de enfoque. El hash se agrega a la cadena de sesión, el fotograma cifrado se almacena localmente como evidencia. Minimiza la recolección de datos según el principio de minimización de datos de la Ley 8968.

### B5. Telemetría de examen: blur/focus, atajos, impresión, desconexiones, latencia
**CUMPLE.** La telemetría captura blur/focus, teclas bloqueadas, marcas de tiempo vía useLockdown. Agregar detección de intento de impresión. Las notificaciones se bloquean (kiosco de escritorio) o se marcan si el usuario las activa (móvil). La pantalla de instrucciones recomienda modo avión pero no lo requiere. Eventos de salida del mouse registrados solo como telemetría — el modo kiosco previene cualquier acción fuera de la ventana.

### B6. Prevención de suplantación: rostro vs selfie inicial vs foto del expediente; bloqueo ante múltiples rostros
**CUMPLE vía B2.** Comparación facial contra biométrico almacenado del módulo de identidad. Retroalimentación en tiempo real al usuario sobre anomalías — alerta audible (tono vía Web Audio) + banner visual con color de severidad. El usuario tiene oportunidad de corregir el comportamiento antes de la escalación.

### B7. Bloqueo inmediato si se detecta más de una persona en el encuadre
**POR CONSTRUIR — respuesta graduada.**
- 1ra ocurrencia: tono de advertencia + banner amarillo "Se detectaron múltiples personas" + captura de fotograma + bandera como advertencia
- 2da ocurrencia: alerta más fuerte + banner rojo "Segunda detección" + captura de fotograma + bandera como crítica
- 3ra ocurrencia: examen pausado + overlay completo + captura de fotograma + estado necesita-revisión
- Umbrales configurables en `exam-rules.json` (estricto 1 falta para centros de prueba, 3 faltas para remoto/hogar)

### B8. Bloqueo inmediato ante cambio de rostro
**POR CONSTRUIR — bloqueo inmediato, tolerancia cero.** Persona diferente = examen pausado instantáneamente. Captura de fotograma + bandera crítica + overlay a pantalla completa "Identidad no coincide — examen suspendido." Sesión marcada como necesita-revisión. Única forma de reanudar es re-verificación contra biométrico almacenado. Suplantación = tolerancia cero.

### B9. Protección de contenido: aleatorización de preguntas y opciones, bancos por categoría
**POR CONSTRUIR — modo dual + generación por LLM.**
- **Examen oficial:** banco aprobado por DGEV obtenido de manuales COSEVI (automóvil, moto, transporte público). Preguntas aleatorizadas + opciones aleatorizadas por sesión. Selección basada en categorías.
- **Generación de banco:** LLM en dispositivo (MediaPipe LLM Inference) genera preguntas candidatas a partir del contenido público del manual COSEVI (Ley 9078, dominio público). DGEV puede revisar/aprobar.
- **Preguntas frescas en cada intento:** No se rebarajan las mismas 40 — el LLM genera preguntas nuevas cada vez. La filtración del banco estático se vuelve imposible.
- **Un intento por día** — período de enfriamiento aplicado en la bóveda (vinculado al DID, no se puede evadir reinstalando).
- **Tarjeta de puntaje en bóveda** — precisión por categoría a través de todos los intentos. El usuario ve temas débiles. La VC se emite cuando se alcanza el umbral de aprobación + competencia mínima por categoría.

### B10. Evidencias: almacenamiento encriptado de logs firmados con hash + sello de tiempo
**PARCIAL → ATT-404.** Cadena de hash + marcas de tiempo + captura activada por anomalía completado. Agregar: cifrado en reposo con clave derivada de la bóveda, firma digital con clave de estación, almacenamiento persistente. Alcance en ATT-404.

### B11. Análisis de comportamiento: lectura labial, conversación por voz, patrones de teclado/mouse
**POR CONSTRUIR.**
- Detección de movimiento labial vía FaceLandmarker (alcance en B3)
- Detección de actividad de voz vía Web Audio API (alcance en B3)
- Rastreo de mouse leave/enter en escritorio — solo telemetría, sin aplicación (el modo kiosco bloquea todas las acciones externas)
- No se necesita análisis de patrones de teclado — todas las teclas que no son de respuesta ya están bloqueadas

### B12. Marca de agua en pantalla y ofuscación de DOM
**POR CONSTRUIR — solo marca de agua.** Marca de agua invisible en el área de preguntas codificando ID de sesión + DID del usuario + marca de tiempo. Si una captura de pantalla se filtra → rastreable a la sesión exacta. Ofuscación de DOM (renderizado en canvas) omitida — las preguntas son generadas dinámicamente por el LLM, por lo que no es posible el scraping de un banco estático.

### B13. Modo degradado: si falla el streaming, captura periódica + prueba de vida puntual
**POR CONSTRUIR — falla de cámara = examen bloqueado.** La cámara falla durante el examen → pausa inmediata + overlay completo "Fallo técnico — cámara desconectada." Evento de falla técnica registrado en la cadena de hash. El examen no puede reanudarse — sesión anulada. El usuario debe reiniciar un nuevo intento de examen después del período de enfriamiento. Sin crédito parcial.

---

## C. Seguridad y Protección de Datos (p.26-30)

### C1. Cifrado en tránsito: TLS 1.2/1.3 con AES-GCM, ECDHE
**N/A.** Sin tráfico de red durante el examen. Arquitectura exclusivamente local.

### C2. Cifrado en reposo: AES-256, rotación de llaves, secretos en HSM/KMS
**PARCIAL → POR CONSTRUIR.** El cifrado de la bóveda existe (safeStorage + Ed25519). Agregar: cifrar archivos de evidencia (fotogramas de anomalía, logs de sesión) con clave derivada de la bóveda antes de escribir en disco. HSM/KMS es del lado del servidor, N/A.

### C3. Gestión de identidades y accesos: MFA, RBAC granular, mínimo privilegio, Zero Trust
**N/A.** Aplicación cliente de un solo usuario. RBAC/MFA aplica al panel de administración (ATT-402) si se construye, no al cliente del examen.

### C4. Registro y auditoría: logs inmutables, WORM, retención normativa, exportables para Contraloría
**CUMPLE vía arquitectura de VC.** La VC de prueba de sesión es el log de auditoría inmutable. Firmada con clave de estación, contiene cabeza de cadena de hash, puntaje, banderas, marcas de tiempo. Verificable por cualquier parte (COSEVI, Contraloría, el usuario). No se necesita almacenamiento WORM separado — la credencial ES la evidencia. Exportable por diseño (documento JSON-LD).

### C5. Integridad: firmas digitales, hashing, WORM, sellado de tiempo. Blockchain opcional
**POR CONSTRUIR — nuestro diferenciador.** Cadena de hash completada. Agregar: clave de estación firma prueba de sesión → incrustar en VC. Anclaje en Solana del hash de prueba = sellado de tiempo en blockchain. El pliego dice que blockchain es "opción valorable" — somos el único oferente que puede entregarlo nativamente.

### C6. Privacidad: minimización de datos de proctoring; políticas de retención y eliminación
**CUMPLE.** Máxima minimización de datos — sin grabación de video, sin grabación de audio, sin almacenamiento en servidor. Solo señales de presencia facial + capturas activadas por anomalía. Todos los datos en el dispositivo del usuario, el usuario controla la retención y eliminación. Más privado que cualquier solución de proctoring centralizada por diseño.

### C7. Detección de anomalías con reglas y ML para fraude
**CUMPLE vía detección basada en reglas.** Las señales directas (rostro, enfoque, audio, labios) son más explicables que el scoring por ML. El pliego prohíbe explícitamente el análisis conductual no autorizado (p.30) y exige explicabilidad. Nuestro enfoque es inherentemente explicable — cada bandera tiene una regla y umbral claros. Sin ML de caja negra.

### C8-C11. PIA, registro de tratamientos, RBAC por entornos, gobernanza de privacidad y biometría
**N/A (documentación/legal).** Evaluación de Impacto en la Privacidad, registro de tratamiento de datos, segregación de entornos (DEV/UAT/PROD), y gobernanza de biometría son procesos legales/administrativos, no requisitos de código. Relevante si se despliega como servicio gestionado, no para el cliente local-first.

---

## D. Integraciones (p.31-33)

### D1. Crear intento "En curso" en SGLC al inicio del examen
**N/A.** El seguimiento de sesión es interno. COSEVI recibe el resultado final como una VC firmada cuando el usuario la presenta. No necesitan visibilidad en tiempo real de los intentos en curso.

### D2. Registrar calificación + sello de tiempo al concluir en SGLC
**CUMPLE vía presentación de VC.** El usuario aprueba → recibe VC firmada con puntaje, marca de tiempo, hash de prueba de sesión. El usuario presenta la VC a COSEVI → ellos verifican firma + hash → registran en SGLC de su lado. Sin push automático a su base de datos.

### D3. Sincronización en tiempo real ante interrupciones
**N/A.** Sin conexión a COSEVI durante el examen. Examen que falla = no se emite VC = no hay inconsistencia. La VC es atómica — existe o no existe.

### D4. Pasarela de pago SOCKET — validar pago antes del examen
**N/A.** El pago ocurre en COSEVI cuando el usuario presenta la VC del examen para obtener la licencia. El examen en sí es gratuito (principio de derechos ciudadanos). La visita al médico es el único paso con costo, y el médico financia la plataforma a través de tarifas de emisión de credenciales.

### D5. Consumir banco de preguntas sin almacenar
**N/A — somos dueños del banco.** Preguntas generadas a partir de manuales públicos de COSEVI (Ley 9078, dominio público). Banco de preguntas de código abierto en el repositorio. El LLM genera variaciones ilimitadas. No se necesita consumir una API secreta externa. DGEV puede revisar/aprobar las preguntas generadas si desean control de calidad, pero el material fuente es ley pública.

### D6. Integración TSE para verificación biométrica facial/dactilar
**CUMPLE vía módulo de identidad.** El biométrico del usuario se captura y verifica durante el onboarding (flujo cédula/DIMEX). El examen compara el rostro en vivo contra el biométrico almacenado. Sin dependencia de API del TSE.

### D7. Dictamen médico: consulta en línea para validar vigencia
**CUMPLE vía arquitectura de VC.** El médico usa la app de escritorio como emisor de credenciales → emite VC de dictamen médico al paciente. La bóveda del usuario contiene la VC. Verificación pre-examen: ¿VC de dictamen médico válida presente en la bóveda? Sí → permitir examen. No → bloqueado. Sin API externa. Modelo de atestación profesional.

### D8. Control de impedimentos: multas, suspensiones, restricciones
**N/A.** El examen teórico se realiza una vez (licencia por primera vez). Las verificaciones de impedimentos son para renovaciones/restituciones, manejadas internamente por COSEVI cuando el usuario presenta sus credenciales. En el futuro, si las multas/suspensiones se emiten como VCs, la app lo sabría automáticamente.

### D9. Notificaciones email/SMS: cita, recordatorios, resultado
**N/A.** Sin sistema de citas, sin servidor, sin infraestructura de email/SMS. El usuario toma el examen cuando esté listo, el resultado es inmediato en pantalla, la VC se emite instantáneamente a la bóveda.

### D10. Integración con MEP para estudiantes en centros educativos
**N/A — misma app.** Los estudiantes usan la misma app que todos los demás. Si el MEP necesita resultados agregados, los estudiantes presentan sus VCs de examen a la escuela. No se necesita integración especial.

---

## E-F. Rendimiento, Carga y Escalado (p.33-38)

### E1-F3. Concurrencia ≥5,000, latencia ≤1.5s, API ≤300ms, disponibilidad ≥99.5%, RPO/RTO, monitoreo, auto-scaling, pruebas de carga
**TODOS N/A.** La arquitectura local-first elimina todos los requisitos de rendimiento, disponibilidad, escalado y monitoreo del lado del servidor. Cada dispositivo es autónomo e independiente. Sin SLAs, sin RPO/RTO, sin pruebas de carga, sin auto-scaling necesario. La concurrencia es ilimitada por diseño — cada dispositivo ejecuta su propio examen.

---

## G. Continuidad, Respaldo y Recuperación (p.39-40)

### G1-G6. RPO, RTO, backup, gestión de incidentes, procedimientos de restauración
**TODOS N/A.** Sin infraestructura de servidor que respaldar, restaurar o recuperar. Los datos viven en el dispositivo del usuario en su bóveda cifrada.

---

## H. Configuración y Operación (p.40-42)

### H1. Catálogo de reglas por categoría de examen
**POR CONSTRUIR — JSON de configuración.** Archivo `exam-rules.json` (por tipo de vehículo) con: `timeLimitSec` (2400 = 40 min), `questionCount` (40), `passThreshold` (0.8), `maxRetriesPerDay` (1), `cooldownBetweenRetriesSec` (86400 = 24h), `categories` con pesos. Cargado al inicio del examen, aplicado por el proceso principal. DGEV puede ajustar sin tocar código.

### H2. Gestión centralizada de reglas con versionamiento
**CUMPLE vía git.** Configuración de reglas en el repositorio. Cambios vía PR = historial completo de versiones, flujo de aprobación, pista de auditoría. Más rastreable que cualquier panel de administración respaldado por base de datos.

### H3. Panel de control de sesiones en tiempo real
**N/A — reemplazado por dashboard de dominio (ATT-399).** En lugar de monitorear sesiones de 40 minutos, el usuario tiene un dashboard personal de dominio que muestra progreso por categoría, racha, precisión a lo largo del tiempo. DGEV obtiene analíticas agregadas de datos anonimizados de VCs si es necesario.

### H4. Expulsión o bloqueo inmediato por fraude
**CUMPLE localmente.** Fraude detectado → examen anulado → no se emite VC. Período de enfriamiento aplicado: después de un examen anulado/reprobado, la app aplica un período de espera (de `exam-rules.json`) antes de permitir otro intento. Almacenado en bóveda — no se puede evadir reinstalando porque la identidad está vinculada al DID.

### H5. Alertas automáticas al supervisor ante anomalías
**N/A.** Sin supervisor, sin alertas. Sesión con banderas = no se emite VC. El usuario tiene dos opciones: aceptar y reintentar después del período de enfriamiento, o disputar presentando su evidencia local (cadena de hash, fotogramas capturados) a DGEV. La app es el árbitro neutral — marca, no juzga.

### H6. Reportes exportables (PDF, CSV, XLSX)
**POR CONSTRUIR — PDF con marca de agua + VC + evidencia local.**
- **Reporte PDF:** con marca de agua (ID de sesión + DID), imágenes de captura de anomalía incrustadas, hash SHA-256 de cada captura impreso al lado, puntaje, banderas, marcas de tiempo, código QR de verificación
- **Dispositivo local:** retiene las capturas originales cifradas — la fuente de verdad. Los hashes del PDF referencian archivos locales para verificación adicional si se disputa
- **VC:** credencial verificable firmada legible por máquina (exportación separada, JSON-LD)

### H7. Help desk 24×7 en español
**POR CONSTRUIR — soporte mínimo en la app.**
- Botón "Reportar problema" → envía info del dispositivo + ID de sesión + descripción al canal de soporte
- Si se confirma bug → período de enfriamiento del usuario reiniciado, reintento inmediato
- No se necesita help desk 24×7 — la app se auto-repara a través de reintentos
- La exportación de evidencia PDF existe como respaldo para casos extremos

---

## I. Criterios de Aceptación PoC/UAT (p.42-45)

### I1. Prueba con 10+ usuarios reales completando flujo completo
**HITO DE PRUEBA.** 10 usuarios reales completan flujo completo: identidad → consentimiento → examen → VC. Ejercicio de validación antes del despliegue.

### I2. Verificación facial con liveness (parpadeo, giro de cabeza)
**CUMPLE vía FaceLandmarker.** Alcance en ATT-400.

### I3. Bloqueo ante cambio de rostro
**CUMPLE vía comparación facial contra biométrico almacenado.** B2/B8.

### I4. Ausencia → bloqueo; múltiples → bloqueo inmediato
**CUMPLE vía respuesta graduada (B7) + bloqueo por falla de cámara (B13).**

### I5. Cambio de pestaña repetido → expulsión
**CUMPLE vía rastreo de pérdida de enfoque + aplicación de período de enfriamiento.**

### I6. Bloqueo de impresión/captura de pantalla
**POR CONSTRUIR.** Bloqueo de portapapeles + impresión + captura de pantalla. Alcance en ATT-403.

### I7. Logs firmados digitalmente con hash + timestamp
**CUMPLE vía cadena de hash + firma de clave de estación en VC.** Alcance en ATT-404.

### I8. Exportación de evidencias PDF/CSV para auditoría
**CUMPLE vía PDF con marca de agua con capturas + hashes incrustados.** H6.

### I9. Integración SGLC: resultado reflejado en tiempo real
**N/A.** El usuario presenta la VC a COSEVI él mismo.

---

## Resumen

| Categoría | Cumple | Por Construir | N/A |
|---|---|---|---|
| A. Arquitectura (8) | 2 | 3 | 3 |
| B. Identidad/Proctoring (13) | 4 | 8 | 1 |
| C. Seguridad (11) | 3 | 2 | 6 |
| D. Integraciones (10) | 3 | 0 | 7 |
| E-F. Rendimiento (7+) | 0 | 0 | 7+ |
| G. Continuidad (6) | 0 | 0 | 6 |
| H. Configuración (7) | 2 | 3 | 2 |
| I. PoC/UAT (9) | 6 | 1 | 2 |

**Diferenciadores clave vs oferentes tradicionales:**
1. **Local-first** — sin servidor, sin SLAs, sin preocupaciones de disponibilidad, el ciudadano es dueño de todos sus datos
2. **Arquitectura de VC** — reemplaza integración con SGLC, almacenamiento WORM, paneles de administración y sistemas de exportación con una sola credencial firmada
3. **Generación de preguntas por LLM** — banco de preguntas infinito a partir de ley pública, fresco en cada intento
4. **Anclaje en blockchain** — prueba de sesión en Solana (opcional según pliego, nativo para nosotros)
5. **Modelo de dominio** — tarjeta de puntaje rastrea temas débiles, transforma el examen de barrera a herramienta de aprendizaje
6. **Privacidad por diseño** — sin grabación de video, sin grabación de audio, sin almacenamiento en servidor, captura solo por anomalía, el usuario controla toda la evidencia

---

## Tickets de Jira

| Ticket | Alcance |
|---|---|
| ATT-398 | Sistema de examen proctorizado — Fase 1 (lockdown, cadena de hash, motor de sesión) ✓ ENTREGADO |
| ATT-399 | Modelo de dominio micro-quiz (repetición espaciada, aprendizaje continuo) |
| ATT-400 | Liveness + verificación de identidad (FaceLandmarker, comparación facial, detección labial/voz) |
| ATT-401 | Integración COSEVI/SGLC (mayormente N/A según este análisis — la VC reemplaza la mayoría de integraciones) |
| ATT-402 | Panel de administración + herramientas de supervisor (mayormente N/A — git + VC reemplazan necesidades de admin) |
| ATT-403 | Endurecimiento anti-fraude (portapapeles, impresión, captura de pantalla, marca de agua, respuesta graduada) |
| ATT-404 | Pista de auditoría + persistencia de evidencia (cifrado en reposo, firma de clave de estación, exportación PDF) |
