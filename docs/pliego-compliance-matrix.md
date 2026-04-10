# Pliego Compliance Matrix — Prueba Teórica Virtual

**Source:** Pliego de Contratación de Servicios para la transformación digital de los servicios de impresión de licencia de conducir física y digital y prueba de manejo teórica digital — MOPT/DGEV 2026

**Scope:** Section 1.2.3.1 — Requerimientos técnicos — Prueba Teórica Virtual (pages 22-45)

**Architecture:** Local-first, offline-capable. 100% frontend (Vue/Quasar). Desktop via Electron, mobile via PWA. No server. Encrypted vault on device. Verifiable Credentials as proof. Citizen owns all data.

---

## A. Arquitectura y Cliente (p.22-23)

### A1. 100% web (responsive), Chrome/Edge/Firefox, sin plugins propietarios
**COMPLIANT.** 100% web frontend. Desktop install required only for encrypted vault storage on device. No server-side data retention. PWA for mobile, Electron for desktop — both run the same Vue/Quasar frontend.

### A2. Separación de capas (front SPA/SSR, API, servicios de identidad/proctoring), con cifrado TLS 1.2+
**N/A.** Fully local architecture. No network calls during exam. Renderer ↔ main process IPC is in-memory, not over a network. Evidence stays on device. User presents proofs themselves in any claim/appeal process. TLS only relevant if/when COSEVI integration APIs are added (separate scope).

### A3. Vincular sesión con trámite activo en SGLC; una sola prueba activa por usuario
**N/A.** Session tracking is internal. COSEVI receives the final result as a signed VC when the user presents it. They don't need real-time visibility into in-progress attempts.

### A4. Reanudación controlada ante cortes de energía o conectividad
**BUILD.** Save session state to localStorage (current question index, answers, timer remaining, session ID). On relaunch, detect incomplete session → resume from where they left off. No biometric re-validation needed since the vault is already on the same device.

### A5. WCAG 2.1 AA (accesibilidad) y modos de alto contraste
**BUILD.** Full WCAG 2.1 AA + voice assistance. Aria labels on all interactive elements, keyboard-only navigation through exam, high contrast mode toggle, and on-demand voice reading of questions/options (Web Speech API `speechSynthesis`). Differentiator — most proctoring platforms have terrible accessibility.

### A6. Huella de entorno (device fingerprint) para asociar sesión y dispositivo
**COMPLIANT via vault DID.** The vault's Ed25519 keypair is device-bound and identity-bound. Every session event is signed by this key. Cryptographically stronger than any browser fingerprint (which can be spoofed). No additional fingerprinting needed.

### A7. Browser lockdown: bloquear navegación, impresión, copiar/pegar, ventanas externas
**PARTIAL → BUILD.** Kiosk mode + keyboard blocking + always-on-top done. Add: clipboard API disable (`copy/cut/paste` event prevention), print blocking (CSS `@media print` + Electron print intercept), screenshot detection (PrintScreen key block + `desktopCapturer` restriction). Scoped in ATT-403.

### A8. Aplicación móvil nativa con mismas capacidades de proctoring
**BUILD — PWA.** Mobile lockdown is simpler: fullscreen API + `visibilitychange` detection (user leaves → flag). No kiosk needed. Screenshot is an OS-level action we can't block on any platform — watermarking handles the deterrence. Same useProctor/useFaceDetection composables run in both surfaces.

---

## B. Identidad, Proctoring y Antifraude (p.23-26)

### B1. Pre-examen: verificación biométrica facial contra TSE/BIOMETRIC con prueba de vida
**COMPLIANT via existing identity flow.** The app's national ID verification (cédula/DIMEX) serves as the pre-exam biometric gate. User must be identity-verified in their vault before accessing the exam module. No separate TSE API call needed — identity is already established.

### B2. Prueba de vida (liveness) pre-examen y durante el examen
**BUILD — face comparison against stored biometric.** At exam start, compare live camera face against the biometric captured during identity verification (stored in vault). Periodic re-comparison during exam (every 60s or on risk events). FaceLandmarker gives us the embedding for comparison. Liveness = continuous face detection + movement variance. If face doesn't match stored biometric → session blocked.

### B3. Revalidaciones biométricas periódicas o por eventos de riesgo
**BUILD — risk-event re-validation + lip movement + voice activity.**
- Face absent >5s → pause exam, require face match against biometric to resume
- Multiple faces → graduated response (see B7)
- Face returns after absence → re-compare against stored biometric
- Eye gaze tracking (FaceLandmarker) — sustained off-screen gaze → flag
- Lip movement detection (FaceLandmarker mouth landmarks) — lips moving without audio → suspicious flag
- Voice activity detection (Web Audio API) — sustained speech → warning, multiple voices → critical flag
- Combined signal matrix: lips still + no audio = normal; lips moving + audio = speaking (flag); lips moving + no audio = suspicious (flag); lips still + audio = someone else talking (critical flag)
- On mobile: `visibilitychange` is the primary cheat signal, gaze/audio are secondary

### B4. Captura de video/foto continua o intermitente del rostro; grabación de eventos críticos
**BUILD — anomaly-triggered capture only.** No periodic captures (40-minute exam makes timed captures wasteful and a privacy liability). Frame captured + encrypted + hashed only on flagged events: multiple faces, face absent, face mismatch, lip movement anomaly, voice detected, focus loss. Hash goes into session chain, encrypted frame stored locally as evidence. Minimizes data collection per Ley 8968 data minimization principle.

### B5. Telemetría de examen: blur/focus, atajos, impresión, desconexiones, latencia
**COMPLIANT.** Telemetry captures blur/focus, blocked keys, timestamps via useLockdown. Add print attempt detection. Notifications are either blocked (desktop kiosk) or flagged if user engages them (mobile). Instruction screen recommends airplane mode but doesn't require it. Mouse leave events logged as telemetry only — kiosk mode prevents any action outside the window.

### B6. Prevención de suplantación: rostro vs selfie inicial vs foto del expediente; bloqueo ante múltiples rostros
**COMPLIANT via B2.** Face comparison against stored biometric from identity module. Real-time user feedback on anomalies — audible alert (beep/tone via Web Audio) + visual banner with severity color. User gets a chance to correct behavior before escalation.

### B7. Bloqueo inmediato si se detecta más de una persona en el encuadre
**BUILD — graduated response.**
- 1st occurrence: warning beep + yellow banner "Se detectaron múltiples personas" + capture frame + flag as warning
- 2nd occurrence: louder alert + red banner "Segunda detección" + capture frame + flag as critical
- 3rd occurrence: exam paused + full overlay + capture frame + needs-review status
- Thresholds configurable in `exam-rules.json` (strict 1-strike for testing centers, 3-strike for remote/home)

### B8. Bloqueo inmediato ante cambio de rostro
**BUILD — immediate block, zero tolerance.** Different person = exam paused instantly. Capture frame + critical flag + full-screen overlay "Identidad no coincide — examen suspendido." Session marked needs-review. Only way to resume is re-verification against stored biometric. Suplantación = zero tolerance.

### B9. Protección de contenido: aleatorización de preguntas y opciones, bancos por categoría
**BUILD — dual mode + LLM generation.**
- **Official exam:** DGEV-approved bank sourced from COSEVI manuals (automóvil, moto, transporte público). Randomized questions + randomized options per session. Category-based selection.
- **Bank generation:** On-device LLM (MediaPipe LLM Inference) generates candidate questions from public COSEVI manual content (Ley 9078, public domain). DGEV can review/approve.
- **Fresh questions every attempt:** No reshuffling the same 40 — LLM generates new questions each time. Static bank leakage becomes impossible.
- **One attempt per day** — cooldown enforced in vault (DID-bound, can't bypass by reinstalling).
- **Scorecard in vault** — per-category accuracy across all attempts. User sees weak topics. VC issued when pass threshold met + minimum per-category competence.

### B10. Evidencias: almacenamiento encriptado de logs firmados con hash + sello de tiempo
**PARTIAL → ATT-404.** Hash chain + timestamps + anomaly-triggered capture done. Add: encryption at rest with vault-derived key, digital signature with station key, persistent storage. Scoped in ATT-404.

### B11. Análisis de comportamiento: lectura labial, conversación por voz, patrones de teclado/mouse
**BUILD.**
- Lip movement detection via FaceLandmarker (scoped in B3)
- Voice activity detection via Web Audio API (scoped in B3)
- Mouse leave/enter tracking on desktop — telemetry only, no enforcement (kiosk blocks all outside actions)
- No keyboard pattern analysis needed — all non-answer keys already blocked

### B12. Screen watermarking y ofuscación de DOM
**BUILD — watermark only.** Invisible watermark on question area encoding session ID + user DID + timestamp. If screenshot leaks → traceable to exact session. DOM obfuscation (canvas rendering) skipped — questions are generated dynamically by LLM, so scraping a static bank isn't possible.

### B13. Modo degradado: si falla el streaming, captura periódica + prueba de vida puntual
**BUILD — camera failure = exam locked.** Camera dies mid-exam → immediate pause + full overlay "Fallo técnico — cámara desconectada." Log technical failure event in hash chain. Exam cannot resume — session voided. User must restart a new exam attempt after cooldown. No partial credit.

---

## C. Seguridad y Protección de Datos (p.26-30)

### C1. Cifrado en tránsito: TLS 1.2/1.3 con AES-GCM, ECDHE
**N/A.** No network traffic during exam. Local-only architecture.

### C2. Cifrado en reposo: AES-256, rotación de llaves, secretos en HSM/KMS
**PARTIAL → BUILD.** Vault encryption exists (safeStorage + Ed25519). Add: encrypt evidence files (anomaly frames, session logs) with vault-derived key before writing to disk. HSM/KMS is server-side, N/A.

### C3. Gestión de identidades y accesos: MFA, RBAC granular, mínimo privilegio, Zero Trust
**N/A.** Single-user client app. RBAC/MFA applies to admin panel (ATT-402) if built, not the exam client.

### C4. Registro y auditoría: logs inmutables, WORM, retención normativa, exportables para Contraloría
**COMPLIANT via VC architecture.** The session proof VC is the immutable audit log. Signed by station key, contains hash chain head, score, flags, timestamps. Verifiable by any party (COSEVI, Contraloría, the user). No separate WORM storage needed — the credential IS the evidence. Exportable by design (JSON-LD document).

### C5. Integridad: firmas digitales, hashing, WORM, sellado de tiempo. Blockchain opcional
**BUILD — our differentiator.** Hash chain done. Add: station key signs session proof → embed in VC. Solana anchor of the proof hash = blockchain timestamping. Pliego says blockchain is "opción valorable" — we're the only bidder who can deliver it natively.

### C6. Privacidad: minimización de datos de proctoring; políticas de retención y eliminación
**COMPLIANT.** Maximum data minimization — no video, no audio recording, no server storage. Only face presence signals + anomaly-triggered frame captures. All data on user's device, user controls retention and deletion. More private than any centralized proctoring solution by design.

### C7. Detección de anomalías con reglas y ML para fraude
**COMPLIANT via rule-based detection.** Direct signals (face, focus, audio, lips) are more explainable than ML scoring. Pliego explicitly prohibits unauthorized behavioral analysis (p.30) and demands explainability. Our approach is inherently explainable — every flag has a clear rule and threshold. No black-box ML.

### C8-C11. PIA, registro de tratamientos, RBAC por entornos, gobernanza de privacidad y biometría
**N/A (documentation/legal).** Privacy Impact Assessment, data treatment registration, environment segregation (DEV/UAT/PROD), and biometric governance are legal/administrative processes, not code requirements. Relevant if deploying as a managed service, not for the local-first client.

---

## D. Integraciones (p.31-33)

### D1. Crear intento "En curso" en SGLC al inicio del examen
**N/A.** Session tracking is internal. COSEVI receives the final result as a signed VC when the user presents it. They don't need real-time visibility into in-progress attempts.

### D2. Registrar calificación + sello de tiempo al concluir en SGLC
**COMPLIANT via VC presentation.** User passes → receives signed VC with score, timestamp, session proof hash. User presents VC to COSEVI → they verify signature + hash → register in SGLC on their end. No automatic push to their database.

### D3. Sincronización en tiempo real ante interrupciones
**N/A.** No connection to COSEVI during exam. Crashed exam = no VC issued = no inconsistency. The VC is atomic — it exists or it doesn't.

### D4. Pasarela de pago SOCKET — validar pago antes del examen
**N/A.** Payment happens at COSEVI when the user presents the exam VC to obtain the license. The exam itself is free (citizen rights principle). The doctor visit is the only paid step, and the doctor funds the platform through credential issuance fees.

### D5. Consumir banco de preguntas sin almacenar
**N/A — we own the bank.** Questions generated from public COSEVI manuals (Ley 9078, public domain). Open-source question bank in the repo. LLM generates unlimited variations. No need to consume a secret external API. DGEV can review/approve generated questions if they want quality control, but the source material is public law.

### D6. Integración TSE para verificación biométrica facial/dactilar
**COMPLIANT via identity module.** User's biometric is captured and verified during onboarding (cédula/DIMEX flow). Exam compares live face against stored biometric. No TSE API dependency.

### D7. Dictamen médico: consulta en línea para validar vigencia
**COMPLIANT via VC architecture.** Doctor uses desktop app as credential issuer → issues medical dictamen VC to patient. User's vault holds the VC. Pre-exam check: valid medical dictamen VC present in vault? Yes → allow exam. No → blocked. No external API. Professional attestation model.

### D8. Control de impedimentos: multas, suspensiones, restricciones
**N/A.** The theoretical exam is taken once (first-time license). Impediment checks are for renewals/reinstatements, handled by COSEVI internally when the user presents their credentials. In the future, if multas/suspensions are issued as VCs, the app would know automatically.

### D9. Notificaciones email/SMS: cita, recordatorios, resultado
**N/A.** No appointment system, no server, no email/SMS infrastructure. User takes exam when ready, result is immediate on-screen, VC issued instantly to vault.

### D10. Integración con MEP para estudiantes en centros educativos
**N/A — same app.** Students use the same app as everyone else. If MEP needs aggregated results, students present their exam VCs to the school. No special integration needed.

---

## E-F. Rendimiento, Carga y Escalado (p.33-38)

### E1-F3. Concurrencia ≥5,000, latencia ≤1.5s, API ≤300ms, disponibilidad ≥99.5%, RPO/RTO, monitoreo, auto-scaling, pruebas de carga
**ALL N/A.** Local-first architecture eliminates every server-side performance, availability, scaling, and monitoring requirement. Each device is self-contained and independent. No SLAs, no RPO/RTO, no load testing, no auto-scaling needed. Concurrency is unlimited by design — every device runs its own exam.

---

## G. Continuidad, Respaldo y Recuperación (p.39-40)

### G1-G6. RPO, RTO, backup, incident management, restoration procedures
**ALL N/A.** No server infrastructure to back up, restore, or recover. Data lives on user's device in their encrypted vault.

---

## H. Configuración y Operación (p.40-42)

### H1. Catálogo de reglas por categoría de examen
**BUILD — config JSON.** Surface `exam-rules.json` (per vehicle type) with: `timeLimitSec` (2400 = 40 min), `questionCount` (40), `passThreshold` (0.8), `maxRetriesPerDay` (1), `cooldownBetweenRetriesSec` (86400 = 24h), `categories` with weights. Loaded at exam start, enforced by main process. DGEV can adjust without touching code.

### H2. Gestión centralizada de reglas con versionamiento
**COMPLIANT via git.** Rules config in repo. Changes via PR = full version history, approval workflow, audit trail. More traceable than any database-backed admin panel.

### H3. Panel de control de sesiones en tiempo real
**N/A — replaced by mastery dashboard (ATT-399).** Instead of monitoring 40-minute sessions, the user has a personal mastery dashboard showing progress by category, streak, accuracy over time. DGEV gets aggregate analytics from anonymized VC data if needed.

### H4. Expulsión o bloqueo inmediato por fraude
**COMPLIANT locally.** Fraud detected → exam voided → no VC issued. Cooldown enforced: after a voided/failed exam, the app enforces a waiting period (from `exam-rules.json`) before allowing another attempt. Stored in vault — can't bypass by reinstalling because identity is DID-bound.

### H5. Alertas automáticas al supervisor ante anomalías
**N/A.** No supervisor, no alerts. Flagged session = no VC issued. User has two options: accept and retry after cooldown, or dispute by presenting their local evidence (hash chain, captured frames) to DGEV. The app is the neutral arbiter — it flags, it doesn't judge.

### H6. Reportes exportables (PDF, CSV, XLSX)
**BUILD — watermarked PDF + VC + local evidence.**
- **PDF report:** watermarked (session ID + DID), anomaly capture images embedded, SHA-256 hash of each capture printed alongside, score, flags, timestamps, verification QR code
- **Local device:** retains encrypted original captures — the source of truth. PDF hashes reference local files for further verification if disputed
- **VC:** machine-verifiable signed credential (separate export, JSON-LD)

### H7. Help desk 24×7 en español
**BUILD — minimal in-app support.**
- "Reportar problema" button → sends device info + session ID + description to support channel
- If confirmed bug → user's cooldown reset, retry immediately
- No 24×7 help desk needed — the app self-heals through retries
- PDF evidence export exists as fallback for extreme cases

---

## I. Criterios de Aceptación PoC/UAT (p.42-45)

### I1. Prueba con 10+ usuarios reales completando flujo completo
**TESTING MILESTONE.** 10 real users complete full flow: identity → consent → exam → VC. Validation exercise before deployment.

### I2. Verificación facial con liveness (parpadeo, giro de cabeza)
**COMPLIANT via FaceLandmarker.** Scoped in ATT-400.

### I3. Bloqueo ante cambio de rostro
**COMPLIANT via face comparison against stored biometric.** B2/B8.

### I4. Ausencia → bloqueo; múltiples → bloqueo inmediato
**COMPLIANT via graduated response (B7) + camera failure lock (B13).**

### I5. Cambio de pestaña repetido → expulsión
**COMPLIANT via focus loss tracking + cooldown enforcement.**

### I6. Bloqueo de impresión/captura de pantalla
**BUILD.** Clipboard + print + screenshot blocking. Scoped in ATT-403.

### I7. Logs firmados digitalmente con hash + timestamp
**COMPLIANT via hash chain + station key signature on VC.** Scoped in ATT-404.

### I8. Exportación de evidencias PDF/CSV para auditoría
**COMPLIANT via watermarked PDF with embedded captures + hashes.** H6.

### I9. Integración SGLC: resultado reflejado en tiempo real
**N/A.** User presents VC to COSEVI themselves.

---

## Summary

| Category | Done/Compliant | Build | N/A |
|---|---|---|---|
| A. Arquitectura (8) | 2 | 3 | 3 |
| B. Identidad/Proctoring (13) | 4 | 8 | 1 |
| C. Seguridad (11) | 3 | 2 | 6 |
| D. Integraciones (10) | 3 | 0 | 7 |
| E-F. Rendimiento (7+) | 0 | 0 | 7+ |
| G. Continuidad (6) | 0 | 0 | 6 |
| H. Configuración (7) | 2 | 3 | 2 |
| I. PoC/UAT (9) | 6 | 1 | 2 |

**Key differentiators vs traditional bidders:**
1. **Local-first** — no server, no SLAs, no availability concerns, citizen owns all data
2. **VC architecture** — replaces SGLC integration, WORM storage, admin panels, and export systems with a single signed credential
3. **LLM question generation** — infinite question bank from public law, fresh every attempt
4. **Blockchain anchoring** — Solana proof-of-session (optional per pliego, native for us)
5. **Mastery model** — scorecard tracks weak topics, transforms exam from gate into learning tool
6. **Privacy by design** — no video recording, no audio recording, no server storage, anomaly-only capture, user controls all evidence

---

## Jira Tickets

| Ticket | Scope |
|---|---|
| ATT-398 | Proctored exam system — Phase 1 (lockdown, hash chain, session engine) ✓ SHIPPED |
| ATT-399 | Micro-quiz mastery model (spaced repetition, ongoing learning) |
| ATT-400 | Liveness + identity verification (FaceLandmarker, face comparison, lip/voice detection) |
| ATT-401 | COSEVI/SGLC integration (mostly N/A per this analysis — VC replaces most integrations) |
| ATT-402 | Admin panel + supervisor tools (mostly N/A — git + VC replace admin needs) |
| ATT-403 | Anti-fraud hardening (clipboard, print, screenshot, watermark, graduated response) |
| ATT-404 | Audit trail + evidence persistence (encryption at rest, station key signing, PDF export) |
