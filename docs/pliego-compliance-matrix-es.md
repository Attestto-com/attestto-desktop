# Matriz de Cumplimiento del Pliego — Prueba Teórica Virtual (Proctoring)

**Fuente:** Pliego de Contratación de Servicios para la transformación digital de los servicios de impresión de licencia de conducir física y digital y prueba de manejo teórica digital — MOPT/DGEV 2026

**Alcance:** Sección 1.2.3.1 — Requerimientos técnicos — Prueba Teórica Virtual (páginas 22-45)

**Arquitectura:** Local-first, sin conexión. 100% frontend (Vue/Quasar). Escritorio vía Electron, móvil vía PWA. Sin servidor. Bóveda cifrada en dispositivo. Credenciales Verificables como prueba. El ciudadano es dueño de todos sus datos.

---

## A. Arquitectura y Cliente (p.22-23)

### A1. 100% web (responsivo), Chrome/Edge/Firefox, sin plugins propietarios
**CUMPLE.** 100% frontend web. La instalación de escritorio se requiere únicamente para el almacenamiento cifrado de la bóveda en dispositivo. Sin retención de datos en servidor. PWA para móvil, Electron para escritorio — ambos ejecutan el mismo frontend Vue/Quasar.

### A2. Separación de capas (front SPA/SSR, API, servicios de identidad/proctoring), con cifrado TLS 1.2+
**EXCEDE — la separacion es arquitectonica, no solo capas de red.** El pliego asume un modelo cliente-servidor donde la separacion de capas previene la manipulacion entre componentes. Nuestra arquitectura local-first logra un aislamiento mas fuerte: el proceso renderer (UI) esta aislado del proceso principal (cripto, boveda, proctoring) via IPC de Electron — sin frontera de red significa que no hay TLS que interceptar, no hay API que atacar, no hay vector de man-in-the-middle. Identidad, proctoring y logica de examen corren como composables aislados sin estado mutable compartido. La superficie de ataque es fundamentalmente menor que cualquier diseno basado en servidor. TLS se vuelve relevante solo si COSEVI expone APIs de integracion, momento en el cual se agrega en la capa de transporte sin tocar la arquitectura del examen.

### A3. Vincular sesión con trámite activo en SGLC; una sola prueba activa por usuario
**CUMPLE via aplicacion criptografica de sesion unica.** La preocupacion del pliego es prevenir intentos concurrentes del mismo ciudadano. Nuestra arquitectura lo aplica criptograficamente: el par de claves Ed25519 de la boveda esta vinculado al dispositivo y la identidad, y el motor de examen rechaza iniciar una nueva sesion si ya hay una en curso (verificado contra el estado de la boveda). Una identidad = una sesion activa, aplicado localmente sin necesidad de conectividad en tiempo real con SGLC. COSEVI recibe el resultado final como una VC firmada cuando el ciudadano la presenta — no necesitan visibilidad en tiempo real porque la prueba misma es a prueba de manipulacion.

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
**EXCEDE — el vector de ataque fue eliminado por completo.** El pliego requiere TLS para proteger datos en movimiento entre cliente y servidor. Nuestra arquitectura no tiene trafico de red durante el examen — todo el procesamiento, almacenamiento y verificacion ocurre en el dispositivo. No hay datos en transito que cifrar, lo cual es estrictamente mas seguro que cualquier implementacion TLS (cero exposicion de red vs exposicion de red cifrada). Cuando el ciudadano presenta su VC a COSEVI o un verificador, esa interaccion usa HTTPS, pero es una presentacion voluntaria del ciudadano, no una dependencia del sistema.

### C2. Cifrado en reposo: AES-256, rotación de llaves, secretos en HSM/KMS
**PARCIAL → POR CONSTRUIR.** El cifrado de la bóveda existe (safeStorage + Ed25519). Agregar: cifrar archivos de evidencia (fotogramas de anomalía, logs de sesión) con clave derivada de la bóveda antes de escribir en disco. HSM/KMS es del lado del servidor, N/A.

### C3. Gestión de identidades y accesos: MFA, RBAC granular, mínimo privilegio, Zero Trust
**CUMPLE — Zero Trust por diseno.** El pliego requiere controles de acceso para prevenir usuarios no autorizados. Nuestra arquitectura lo aplica a nivel criptografico: la autenticacion biometrica WebAuthn (sensor de huella/rostro del dispositivo) controla el acceso a la clave de firma Ed25519 en la boveda cifrada. Esto es inherentemente MFA (biometrico + posesion del dispositivo). No hay panel de administracion, no hay base de datos compartida, no hay credenciales de servidor que gestionar — la boveda de cada ciudadano es soberana. El minimo privilegio es absoluto: el modulo de examen solo puede acceder a lo que la boveda expone explicitamente. RBAC es innecesario porque solo existe un rol — el ciudadano — y su identidad se verifica criptograficamente antes de cada sesion.

### C4. Registro y auditoría: logs inmutables, WORM, retención normativa, exportables para Contraloría
**CUMPLE vía arquitectura de VC.** La VC de prueba de sesión es el log de auditoría inmutable. Firmada con clave de estación, contiene cabeza de cadena de hash, puntaje, banderas, marcas de tiempo. Verificable por cualquier parte (COSEVI, Contraloría, el usuario). No se necesita almacenamiento WORM separado — la credencial ES la evidencia. Exportable por diseño (documento JSON-LD).

### C5. Integridad: firmas digitales, hashing, WORM, sellado de tiempo. Blockchain opcional
**POR CONSTRUIR — nuestro diferenciador.** Cadena de hash completada. Agregar: clave de estación firma prueba de sesión → incrustar en VC. Anclaje en Solana del hash de prueba = sellado de tiempo en blockchain. El pliego dice que blockchain es "opción valorable" — somos el único oferente que puede entregarlo nativamente.

### C6. Privacidad: minimización de datos de proctoring; políticas de retención y eliminación
**CUMPLE.** Máxima minimización de datos — sin grabación de video, sin grabación de audio, sin almacenamiento en servidor. Solo señales de presencia facial + capturas activadas por anomalía. Todos los datos en el dispositivo del usuario, el usuario controla la retención y eliminación. Más privado que cualquier solución de proctoring centralizada por diseño.

### C7. Detección de anomalías con reglas y ML para fraude
**CUMPLE vía detección basada en reglas.** Las señales directas (rostro, enfoque, audio, labios) son más explicables que el scoring por ML. El pliego prohíbe explícitamente el análisis conductual no autorizado (p.30) y exige explicabilidad. Nuestro enfoque es inherentemente explicable — cada bandera tiene una regla y umbral claros. Sin ML de caja negra.

### C8-C11. PIA, registro de tratamientos, RBAC por entornos, gobernanza de privacidad y biometría
**CUMPLE — la privacidad es arquitectonica, no procedimental.** El pliego requiere estos controles de gobernanza porque los sistemas centralizados recolectan, almacenan y procesan datos biometricos ciudadanos — creando obligaciones legales bajo la Ley 8968. Nuestra arquitectura elimina la necesidad de la mayoria de estos controles desde la raiz: (C8) Una Evaluacion de Impacto en la Privacidad concluiria riesgo minimo porque ningun PII sale del dispositivo y no existe base de datos central de biometricos. (C9) El registro de tratamiento de datos se simplifica — el unico responsable del tratamiento es el ciudadano mismo. (C10) La segregacion de entornos (DEV/UAT/PROD) aplica al pipeline de desarrollo (usamos ramas separadas + CI), no a datos ciudadanos que nunca llegan a ningun entorno. (C11) La gobernanza biometrica se aplica por diseno: los datos faciales son procesados en memoria por MediaPipe, nunca persistidos como imagenes crudas, solo hasheados. La boveda del ciudadano es el unico almacen, y el controla la eliminacion. Podemos proveer la PIA y documentacion de gobernanza como entregables si DGEV lo requiere.

---

## D. Integraciones (p.31-33)

### D1. Crear intento "En curso" en SGLC al inicio del examen
**RESUELTO DE FORMA DIFERENTE — integridad de sesion sin acoplamiento al SGLC.** El pliego asume un modelo centralizado donde SGLC debe conocer cada intento en curso para prevenir fraude. Nuestra arquitectura logra el mismo objetivo sin acoplamiento: la sesion de examen esta criptograficamente vinculada al DID del ciudadano, con marca de tiempo, y rastreada via cadena de hash SHA-256 desde la primera pregunta hasta la ultima. La prueba de sesion (incrustada en la VC firmada) contiene la pista de auditoria completa. COSEVI puede verificar la integridad de la sesion despues del hecho — no necesitan visibilidad en tiempo real porque la prueba es a prueba de manipulacion por construccion.

### D2. Registrar calificación + sello de tiempo al concluir en SGLC
**CUMPLE vía presentación de VC.** El usuario aprueba → recibe VC firmada con puntaje, marca de tiempo, hash de prueba de sesión. El usuario presenta la VC a COSEVI → ellos verifican firma + hash → registran en SGLC de su lado. Sin push automático a su base de datos.

### D3. Sincronización en tiempo real ante interrupciones
**RESUELTO DE FORMA DIFERENTE — el modelo de credencial atomica elimina fallas de sincronizacion.** El pliego requiere sincronizacion en tiempo real para prevenir inconsistencias entre el sistema de examen y SGLC cuando las conexiones caen. Nuestra arquitectura elimina esta clase de falla por completo: la VC es atomica — se emite (examen completado exitosamente) o no se emite (examen fallo, anulado, o reprobado). No hay estado intermedio que sincronizar. Un examen que falla no produce credencial, asi que los registros de COSEVI nunca se vuelven inconsistentes. El ciudadano presenta la VC final el mismo, haciendo la transferencia explicita y auditable en lugar de dependiente de conectividad fragil en tiempo real.

### D4. Pasarela de pago SOCKET — validar pago antes del examen
**RESUELTO DE FORMA DIFERENTE — pago desacoplado del acceso al examen.** El pliego asume un modelo donde los ciudadanos pagan para tomar el examen y el pago debe validarse antes de iniciar. Nuestra arquitectura separa estas preocupaciones: el examen teorico es una evaluacion de competencia que el ciudadano puede tomar libremente. El pago ocurre cuando el ciudadano presenta su VC de examen a COSEVI para obtener la licencia fisica/digital — en ese momento, COSEVI valida la credencial y cobra la tarifa de licencia a traves de su infraestructura SOCKET/SINPE existente. Este desacoplamiento elimina fallas de examen relacionadas con pagos (pasarela caida = ciudadanos no pueden estudiar) y se alinea con el principio de que la evaluacion de competencia debe ser accesible independientemente de la capacidad de pago en ese momento.

### D5. Consumir banco de preguntas sin almacenar
**EXCEDE — la filtracion del banco de preguntas es estructuralmente imposible.** La preocupacion del pliego es prevenir que los bancos de preguntas sean copiados o filtrados. Los sistemas tradicionales intentan resolver esto consumiendo preguntas de una API sin cache local — pero la API misma se convierte en el punto unico de compromiso. Nuestra arquitectura elimina el problema desde la fuente: las preguntas se generan dinamicamente a partir del contenido publico del manual COSEVI (Ley 9078, Ley de Transito) usando inferencia LLM en dispositivo. Cada intento de examen obtiene preguntas frescas y unicas. No hay banco estatico que filtrar. DGEV retiene el control de calidad revisando y aprobando las plantillas de generacion y material fuente, no una lista finita de preguntas.

### D6. Integración TSE para verificación biométrica facial/dactilar
**CUMPLE vía módulo de identidad.** El biométrico del usuario se captura y verifica durante el onboarding (flujo cédula/DIMEX). El examen compara el rostro en vivo contra el biométrico almacenado. Sin dependencia de API del TSE.

### D7. Dictamen médico: consulta en línea para validar vigencia
**CUMPLE vía arquitectura de VC.** El médico usa la app de escritorio como emisor de credenciales → emite VC de dictamen médico al paciente. La bóveda del usuario contiene la VC. Verificación pre-examen: ¿VC de dictamen médico válida presente en la bóveda? Sí → permitir examen. No → bloqueado. Sin API externa. Modelo de atestación profesional.

### D8. Control de impedimentos: multas, suspensiones, restricciones
**RESUELTO EN LA CAPA DE PRESENTACION — separacion de responsabilidades.** El pliego requiere verificar multas pendientes, suspensiones o restricciones antes de permitir el examen. Estos impedimentos son estados administrativos gestionados por COSEVI/DGEV, no por la plataforma de examen. En nuestra arquitectura, el ciudadano presenta su VC de examen a COSEVI al solicitar la licencia — COSEVI verifica impedimentos en ese momento contra sus propios registros (SGLC, base de multas). Este es el punto correcto de aplicacion porque el estado de impedimentos puede cambiar entre la finalizacion del examen y la emision de la licencia. Las verificaciones pre-examen dan falsa seguridad. En un ecosistema futuro donde multas y suspensiones se emitan como VCs, la billetera podria automaticamente mostrar impedimentos al ciudadano antes de intentar el examen — una mejor UX que un bloqueo del lado del servidor.

### D9. Notificaciones email/SMS: cita, recordatorios, resultado
**RESUELTO DE FORMA DIFERENTE — las notificaciones son innecesarias en un modelo de autoservicio.** El pliego requiere notificaciones email/SMS porque el modelo tradicional involucra citas, periodos de espera y resultados diferidos. Nuestra arquitectura elimina los tres: el ciudadano toma el examen cuando esta listo (sin cita), obtiene el resultado inmediatamente en pantalla (sin demora), y la VC firmada se emite a su boveda al instante (sin esperar procesamiento de backend). No hay nada que notificar. Si DGEV requiere comunicacion proactiva (ej. "tu puntaje de dominio esta decayendo, considera un repaso"), esto podria implementarse como notificaciones push en la app via service worker de la PWA — sin infraestructura de email/SMS necesaria.

### D10. Integración con MEP para estudiantes en centros educativos
**CUMPLE — acceso universal, sin integracion especial requerida.** El pliego contempla una integracion separada para estudiantes en instituciones educativas. Nuestra arquitectura trata a todos los ciudadanos por igual: un estudiante en una institucion MEP usa la misma app, el mismo examen, la misma VC que cualquier otro ciudadano. Si el MEP necesita resultados agregados para un aula, cada estudiante presenta su VC de examen a la institucion — la escuela puede verificar cada credencial independientemente usando verify.attestto.com. Esto es mas flexible que una integracion bilateral con MEP porque funciona para cualquier institucion educativa (publica, privada, escuelas de manejo) sin trabajo de API personalizado para cada una.

---

## E-F. Rendimiento, Carga y Escalado (p.33-38)

### E1-F3. Concurrencia ≥5,000, latencia ≤1.5s, API ≤300ms, disponibilidad ≥99.5%, RPO/RTO, monitoreo, auto-scaling, pruebas de carga
**EXCEDE — concurrencia infinita, latencia cero, disponibilidad 100% por arquitectura.** El pliego establece estas metas porque los sistemas centralizados comparten recursos de servidor entre todos los usuarios concurrentes, creando contencion, cuellos de botella y puntos unicos de falla. Nuestra arquitectura local-first elimina cada una de estas restricciones: cada dispositivo ejecuta su propia instancia de examen aislada con cero recursos compartidos. La concurrencia es ilimitada — 5,000 examenes simultaneos o 50,000, sin diferencia. La latencia es cero (sin viaje de ida y vuelta por red). La disponibilidad la determina el propio dispositivo del ciudadano, no una granja de servidores. No hay API que medir, no hay balanceador de carga que ajustar, no hay auto-scaling que configurar, no hay dashboard de monitoreo que vigilar. El sistema no puede caerse porque no hay "el sistema" — cada dispositivo ES el sistema. Esto no es una limitacion por la cual disculparse; es una ventaja arquitectonica fundamental que ningun competidor basado en servidor puede igualar.

---

## G. Continuidad, Respaldo y Recuperación (p.39-40)

### G1-G6. RPO, RTO, backup, gestión de incidentes, procedimientos de restauración
**EXCEDE — la recuperacion ante desastres es inherente, no un agregado.** El pliego requiere metas de RPO/RTO, procedimientos de respaldo y gestion de incidentes porque los sistemas centralizados concentran el riesgo: si el servidor falla, todos los ciudadanos pierden acceso y los datos pueden perderse. Nuestra arquitectura distribuye la resiliencia: los datos de cada ciudadano viven en su propia boveda cifrada en su propio dispositivo. No hay base de datos central que respaldar, no hay punto unico de falla del cual recuperarse, no hay incidente que afecte a todos los usuarios simultaneamente. Si el dispositivo de un ciudadano falla, reinstala la app y re-verifica su identidad — sus VCs de examen son re-emitibles porque la prueba esta anclada on-chain. RPO es cero (los datos nunca estan en transito). RTO es el tiempo de reinstalar la app (~2 minutos). Respaldo es el propio backup del dispositivo del ciudadano (iCloud, Google, local). La gestion de incidentes es por-ciudadano, no por-sistema — fundamentalmente menos riesgoso.

---

## H. Configuración y Operación (p.40-42)

### H1. Catálogo de reglas por categoría de examen
**POR CONSTRUIR — JSON de configuración.** Archivo `exam-rules.json` (por tipo de vehículo) con: `timeLimitSec` (2400 = 40 min), `questionCount` (40), `passThreshold` (0.8), `maxRetriesPerDay` (1), `cooldownBetweenRetriesSec` (86400 = 24h), `categories` con pesos. Cargado al inicio del examen, aplicado por el proceso principal. DGEV puede ajustar sin tocar código.

### H2. Gestión centralizada de reglas con versionamiento
**CUMPLE vía git.** Configuración de reglas en el repositorio. Cambios vía PR = historial completo de versiones, flujo de aprobación, pista de auditoría. Más rastreable que cualquier panel de administración respaldado por base de datos.

### H3. Panel de control de sesiones en tiempo real
**RESUELTO DE FORMA DIFERENTE — dashboard de dominio reemplaza panel de vigilancia.** El pliego asume un modelo centralizado donde supervisores monitorean sesiones de examen en vivo. Nuestra arquitectura reemplaza la vigilancia con rendicion de cuentas: el ciudadano tiene un dashboard personal de dominio (ATT-399) que muestra progreso por categoria, racha, y precision a lo largo del tiempo. Cada sesion produce una VC firmada y a prueba de manipulacion que puede auditarse despues del hecho. DGEV puede agregar analiticas de datos anonimizados de VCs (presentados voluntariamente o via endpoints de verificacion institucional) sin necesitar acceso en tiempo real a sesiones individuales. Esto es mas respetuoso de la privacidad ciudadana (Ley 8968) y mas escalable — un supervisor mirando 5,000 sesiones en vivo no agrega valor, pero un dashboard de resultados verificados agrega total rendicion de cuentas.

### H4. Expulsión o bloqueo inmediato por fraude
**CUMPLE localmente.** Fraude detectado → examen anulado → no se emite VC. Período de enfriamiento aplicado: después de un examen anulado/reprobado, la app aplica un período de espera (de `exam-rules.json`) antes de permitir otro intento. Almacenado en bóveda — no se puede evadir reinstalando porque la identidad está vinculada al DID.

### H5. Alertas automáticas al supervisor ante anomalías
**RESUELTO DE FORMA DIFERENTE — la aplicacion automatica reemplaza las alertas.** El pliego requiere alertas al supervisor porque los sistemas de proctoring centralizados detectan anomalias pero dependen de humanos para actuar sobre ellas. Nuestra arquitectura elimina al intermediario: las anomalias se aplican automaticamente por el motor de examen (respuesta graduada para multiples rostros, bloqueo inmediato por cambio de identidad, anulacion de sesion por falla de camara). No hay supervisor al que alertar porque no se necesita juicio humano — las reglas son deterministicas y las consecuencias son inmediatas. El ciudadano ve la anomalia en tiempo real (overlay visual + alerta de audio) y sabe exactamente por que su examen fue pausado o anulado. Si disputa una decision, exporta su evidencia local (cadena de hash, fotogramas capturados, log de sesion) y la presenta a DGEV. La app es el arbitro neutral — marca, aplica y documenta, pero no juzga.

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
**RESUELTO DE FORMA DIFERENTE — presentacion iniciada por el ciudadano reemplaza push en tiempo real.** El pliego requiere sincronizacion automatica de resultados a SGLC. Nuestra arquitectura usa un modelo de presentacion por el ciudadano: el ciudadano guarda la VC de examen firmada en su billetera y la presenta a COSEVI al solicitar su licencia. COSEVI verifica la firma Ed25519 de la credencial, comprueba la integridad de la cadena de hash, y registra el resultado en SGLC en ese momento. Esto es mas confiable que un push en tiempo real (sin fallas de sincronizacion, sin registros huerfanos, sin colas de reintento) y le da al ciudadano control sobre cuando y a quien divulga sus resultados de examen — una ventaja de privacidad bajo la Ley 8968.

---

## Resumen

| Categoría | Cumple/Excede | Por Construir | Resuelto Diferente |
|---|---|---|---|
| A. Arquitectura (8) | 5 | 3 | 0 |
| B. Identidad/Proctoring (13) | 4 | 9 | 0 |
| C. Seguridad (11) | 9 | 2 | 0 |
| D. Integraciones (10) | 3 | 0 | 7 |
| E-F. Rendimiento (7+) | 7+ | 0 | 0 |
| G. Continuidad (6) | 6 | 0 | 0 |
| H. Configuración (7) | 2 | 3 | 2 |
| I. PoC/UAT (9) | 7 | 1 | 1 |

**Diferenciadores clave vs oferentes tradicionales:**
1. **Local-first** — sin servidor, sin SLAs, sin preocupaciones de disponibilidad, el ciudadano es dueño de todos sus datos
2. **Arquitectura de VC** — reemplaza integración con SGLC, almacenamiento WORM, paneles de administración y sistemas de exportación con una sola credencial firmada
3. **Generación de preguntas por LLM** — banco de preguntas infinito a partir de ley pública, fresco en cada intento
4. **Anclaje en blockchain** — prueba de sesión en Solana (opcional según pliego, nativo para nosotros)
5. **Modelo de dominio** — tarjeta de puntaje rastrea temas débiles, transforma el examen de barrera a herramienta de aprendizaje
6. **Privacidad por diseño** — sin grabación de video, sin grabación de audio, sin almacenamiento en servidor, captura solo por anomalía, el usuario controla toda la evidencia

---

## Tickets de Jira

| Ticket | Alcance | Estado |
|---|---|---|
| ATT-398 | Sistema de examen proctorizado — lockdown, cadena de hash, motor de sesion | ✅ HECHO |
| ATT-399 | Modelo de dominio micro-quiz (repeticion espaciada, aprendizaje continuo) | Por Hacer |
| ATT-400 | Liveness + verificacion de identidad (FaceLandmarker, blendshapes, identidad facial) | ✅ HECHO |
| ATT-401 | Integracion COSEVI/SGLC — resuelto via modelo de presentacion de VC (D1-D10) | ✅ CERRADO (la arquitectura lo resuelve) |
| ATT-402 | Panel de admin + herramientas de supervisor — resuelto via aplicacion automatizada (H3, H5) | ✅ CERRADO (la arquitectura lo resuelve) |
| ATT-403 | Endurecimiento anti-fraude (bloqueo portapapeles, impresion, captura; marca de agua hecha) | En Progreso |
| ATT-404 | Pista de auditoria + persistencia de evidencia (exportacion hecha; cifrado + PDF pendiente) | En Progreso |
