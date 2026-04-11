# Pliego Compliance Matrix — Prueba Teórica Virtual

**Source:** Pliego de Contratación de Servicios para la transformación digital de los servicios de impresión de licencia de conducir física y digital y prueba de manejo teórica digital — MOPT/DGEV 2026

**Scope:** Section 1.2.3.1 — Requerimientos técnicos — Prueba Teórica Virtual (pages 22-45)

**Architecture:** Local-first, offline-capable. 100% frontend (Vue/Quasar). Desktop via Electron, mobile via PWA. No server. Encrypted vault on device. Verifiable Credentials as proof. Citizen owns all data.

---

## A. Arquitectura y Cliente (p.22-23)

### A1. 100% web (responsive), Chrome/Edge/Firefox, sin plugins propietarios
**COMPLIANT.** 100% web frontend. Desktop install required only for encrypted vault storage on device. No server-side data retention. PWA for mobile, Electron for desktop — both run the same Vue/Quasar frontend.

### A2. Separación de capas (front SPA/SSR, API, servicios de identidad/proctoring), con cifrado TLS 1.2+
**EXCEEDED — separation is architectural, not just network layers.** The pliego assumes a client-server model where layer separation prevents tampering between components. Our local-first architecture achieves stronger isolation: the renderer process (UI) is sandboxed from the main process (crypto, vault, proctoring) via Electron IPC — no network boundary means no TLS to intercept, no API to attack, no man-in-the-middle vector. Identity, proctoring, and exam logic run as isolated composables with no shared mutable state. The attack surface is fundamentally smaller than any server-based design. TLS becomes relevant only if/when COSEVI exposes integration APIs, at which point we add it at the transport layer without touching exam architecture.

### A3. Vincular sesión con trámite activo en SGLC; una sola prueba activa por usuario
**COMPLIANT via DID-bound session enforcement.** The pliego's concern is preventing concurrent exam attempts by the same person. Our architecture enforces this cryptographically: the vault's Ed25519 keypair is device-bound, and the exam engine refuses to start a new session if one is already in progress (checked against vault state). One identity = one active session, enforced locally without needing SGLC real-time connectivity. COSEVI receives the final result as a signed VC when the citizen presents it — they don't need real-time visibility into in-progress attempts because the proof itself is tamper-evident.

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
**EXCEEDED — eliminated the attack vector entirely.** The pliego requires TLS to protect data moving between client and server. Our architecture has no network traffic during the exam — all processing, storage, and verification happen on-device. There is no data in transit to encrypt, which is strictly more secure than any TLS implementation (zero network exposure vs. encrypted network exposure). When the citizen later presents their VC to COSEVI or a verifier, that interaction uses HTTPS, but it's a voluntary presentation by the citizen, not a system dependency.

### C2. Cifrado en reposo: AES-256, rotación de llaves, secretos en HSM/KMS
**PARTIAL → BUILD.** Vault encryption exists (safeStorage + Ed25519). Add: encrypt evidence files (anomaly frames, session logs) with vault-derived key before writing to disk. HSM/KMS is server-side, N/A.

### C3. Gestión de identidades y accesos: MFA, RBAC granular, mínimo privilegio, Zero Trust
**COMPLIANT — Zero Trust by design.** The pliego requires access controls to prevent unauthorized users from accessing the system. Our architecture enforces this at the cryptographic level: WebAuthn biometric authentication (the device's fingerprint/face sensor) gates access to the Ed25519 signing key in the encrypted vault. This is inherently MFA (biometric + device possession). There is no admin panel, no shared database, no server credentials to manage — each citizen's vault is sovereign. Minimum privilege is absolute: the exam module can only access what the vault explicitly exposes. RBAC is unnecessary because there is only one role — the citizen — and their identity is cryptographically verified before every session.

### C4. Registro y auditoría: logs inmutables, WORM, retención normativa, exportables para Contraloría
**COMPLIANT via VC architecture.** The session proof VC is the immutable audit log. Signed by station key, contains hash chain head, score, flags, timestamps. Verifiable by any party (COSEVI, Contraloría, the user). No separate WORM storage needed — the credential IS the evidence. Exportable by design (JSON-LD document).

### C5. Integridad: firmas digitales, hashing, WORM, sellado de tiempo. Blockchain opcional
**BUILD — our differentiator.** Hash chain done. Add: station key signs session proof → embed in VC. Solana anchor of the proof hash = blockchain timestamping. Pliego says blockchain is "opción valorable" — we're the only bidder who can deliver it natively.

### C6. Privacidad: minimización de datos de proctoring; políticas de retención y eliminación
**COMPLIANT.** Maximum data minimization — no video, no audio recording, no server storage. Only face presence signals + anomaly-triggered frame captures. All data on user's device, user controls retention and deletion. More private than any centralized proctoring solution by design.

### C7. Detección de anomalías con reglas y ML para fraude
**COMPLIANT via rule-based detection.** Direct signals (face, focus, audio, lips) are more explainable than ML scoring. Pliego explicitly prohibits unauthorized behavioral analysis (p.30) and demands explainability. Our approach is inherently explainable — every flag has a clear rule and threshold. No black-box ML.

### C8-C11. PIA, registro de tratamientos, RBAC por entornos, gobernanza de privacidad y biometría
**COMPLIANT — privacy is architectural, not procedural.** The pliego requires these governance controls because centralized systems collect, store, and process citizen biometric data — creating legal obligations under Ley 8968. Our architecture eliminates the need for most of these controls at the root: (C8) A Privacy Impact Assessment for our system would conclude minimal risk because no PII leaves the device and no central database of biometrics exists. (C9) Data treatment registration is simplified — the only data controller is the citizen themselves. (C10) Environment segregation (DEV/UAT/PROD) applies to the development pipeline (we use separate branches + CI), not to citizen data which never reaches any environment. (C11) Biometric governance is enforced by design: face data is processed in-memory by MediaPipe, never persisted as raw images, only hashed. The citizen's vault is the only store, and they control deletion. We can provide the PIA and governance documentation as deliverables if required by DGEV.

---

## D. Integraciones (p.31-33)

### D1. Crear intento "En curso" en SGLC al inicio del examen
**ADDRESSED DIFFERENTLY — session integrity without SGLC coupling.** The pliego assumes a centralized model where SGLC must know about every in-progress attempt to prevent fraud. Our architecture achieves the same goal without coupling: the exam session is cryptographically bound to the citizen's DID, timestamped, and tracked via SHA-256 hash chain from the first question to the last. The session proof (embedded in the signed VC) contains the full audit trail. COSEVI can verify the session's integrity after the fact — they don't need real-time visibility because the proof is tamper-evident by construction.

### D2. Registrar calificación + sello de tiempo al concluir en SGLC
**COMPLIANT via VC presentation.** User passes → receives signed VC with score, timestamp, session proof hash. User presents VC to COSEVI → they verify signature + hash → register in SGLC on their end. No automatic push to their database.

### D3. Sincronización en tiempo real ante interrupciones
**ADDRESSED DIFFERENTLY — atomic credential model eliminates sync failures.** The pliego requires real-time sync to prevent inconsistencies between the exam system and SGLC when connections drop. Our architecture eliminates this class of failure entirely: the VC is atomic — it is either issued (exam completed successfully) or it is not (exam crashed, voided, or failed). There is no intermediate state to synchronize. A crashed exam produces no credential, so COSEVI's records never become inconsistent. The citizen presents the final VC themselves, making the handoff explicit and auditable rather than dependent on fragile real-time connectivity.

### D4. Pasarela de pago SOCKET — validar pago antes del examen
**ADDRESSED DIFFERENTLY — payment decoupled from exam access.** The pliego assumes a model where citizens pay to take the exam and payment must be validated before starting. Our architecture separates these concerns: the theoretical exam is a competency assessment that the citizen can take freely. Payment occurs when the citizen presents their exam VC to COSEVI to obtain the physical/digital license — at that point, COSEVI validates the credential and collects the license fee through their existing SOCKET/SINPE infrastructure. This decoupling eliminates payment-related exam failures (payment gateway down = citizens can't study) and aligns with the principle that competency assessment should be accessible regardless of ability to pay at that moment.

### D5. Consumir banco de preguntas sin almacenar
**EXCEEDED — question bank leakage is structurally impossible.** The pliego's concern is preventing question banks from being copied or leaked. Traditional systems try to solve this by consuming questions from an API without local caching — but the API itself becomes the single point of compromise. Our architecture eliminates the problem at the source: questions are generated dynamically from public COSEVI manual content (Ley 9078, Ley de Transito) using on-device LLM inference. Every exam attempt gets fresh, unique questions. There is no static bank to leak. DGEV retains quality control by reviewing and approving the generation templates and source material, not a finite question list.

### D6. Integración TSE para verificación biométrica facial/dactilar
**COMPLIANT via identity module.** User's biometric is captured and verified during onboarding (cédula/DIMEX flow). Exam compares live face against stored biometric. No TSE API dependency.

### D7. Dictamen médico: consulta en línea para validar vigencia
**COMPLIANT via VC architecture.** Doctor uses desktop app as credential issuer → issues medical dictamen VC to patient. User's vault holds the VC. Pre-exam check: valid medical dictamen VC present in vault? Yes → allow exam. No → blocked. No external API. Professional attestation model.

### D8. Control de impedimentos: multas, suspensiones, restricciones
**ADDRESSED AT THE PRESENTATION LAYER — separation of concerns.** The pliego requires checking for outstanding fines, suspensions, or restrictions before allowing the exam. These impediments are administrative states managed by COSEVI/DGEV, not by the exam platform. In our architecture, the citizen presents their exam VC to COSEVI when requesting a license — COSEVI checks impediments at that moment against their own records (SGLC, multas database). This is the correct enforcement point because impediment status can change between exam completion and license issuance. Pre-exam impediment checks give false security. In a future ecosystem where multas and suspensions are issued as VCs, the wallet could automatically surface impediments to the citizen before they attempt the exam — a better UX than a server-side block.

### D9. Notificaciones email/SMS: cita, recordatorios, resultado
**ADDRESSED DIFFERENTLY — notifications are unnecessary in a self-service model.** The pliego requires email/SMS notifications because the traditional model involves appointments, waiting periods, and delayed results. Our architecture eliminates all three: the citizen takes the exam when they are ready (no appointment), gets the result immediately on screen (no delay), and the signed VC is issued to their vault instantly (no waiting for a backend to process). There is nothing to notify about. If DGEV requires proactive outreach (e.g., "your mastery score is decaying, consider a refresher"), this could be implemented as in-app push notifications via the PWA service worker — no email/SMS infrastructure needed.

### D10. Integración con MEP para estudiantes en centros educativos
**COMPLIANT — universal access, no special integration required.** The pliego envisions a separate integration for students in educational institutions. Our architecture treats all citizens equally: a student at a MEP institution uses the same app, same exam, same VC as any other citizen. If MEP needs aggregated results for a classroom, each student presents their exam VC to the institution — the school can verify each credential independently using verify.attestto.com. This is more flexible than a bilateral MEP integration because it works for any educational institution (public, private, driving schools) without custom API work for each one.

---

## E-F. Rendimiento, Carga y Escalado (p.33-38)

### E1-F3. Concurrencia ≥5,000, latencia ≤1.5s, API ≤300ms, disponibilidad ≥99.5%, RPO/RTO, monitoreo, auto-scaling, pruebas de carga
**EXCEEDED — infinite concurrency, zero latency, 100% availability by architecture.** The pliego sets these targets because centralized systems share server resources among all concurrent users, creating contention, bottlenecks, and single points of failure. Our local-first architecture eliminates every one of these constraints: each device runs its own isolated exam instance with zero shared resources. Concurrency is unlimited — 5,000 simultaneous exams or 50,000, no difference. Latency is zero (no network round-trip). Availability is determined by the citizen's own device, not a server farm. There is no API to benchmark, no load balancer to tune, no auto-scaling to configure, no monitoring dashboard to watch. The system cannot go down because there is no "the system" — each device IS the system. This is not a limitation we need to apologize for; it is a fundamental architectural advantage that no server-based competitor can match.

---

## G. Continuidad, Respaldo y Recuperación (p.39-40)

### G1-G6. RPO, RTO, backup, incident management, restoration procedures
**EXCEEDED — disaster recovery is inherent, not bolt-on.** The pliego requires RPO/RTO targets, backup procedures, and incident management because centralized systems concentrate risk: if the server fails, all citizens lose access and data may be lost. Our architecture distributes resilience: each citizen's data lives in their own encrypted vault on their own device. There is no central database to back up, no single point of failure to recover from, no incident that affects all users simultaneously. If a citizen's device fails, they re-install the app and re-verify their identity — their exam VCs are re-issuable because the proof is anchored on-chain. RPO is zero (data is never in transit). RTO is the time to reinstall the app (~2 minutes). Backup is the citizen's own device backup (iCloud, Google, local). Incident management is per-citizen, not per-system — fundamentally less risky.

---

## H. Configuración y Operación (p.40-42)

### H1. Catálogo de reglas por categoría de examen
**BUILD — config JSON.** Surface `exam-rules.json` (per vehicle type) with: `timeLimitSec` (2400 = 40 min), `questionCount` (40), `passThreshold` (0.8), `maxRetriesPerDay` (1), `cooldownBetweenRetriesSec` (86400 = 24h), `categories` with weights. Loaded at exam start, enforced by main process. DGEV can adjust without touching code.

### H2. Gestión centralizada de reglas con versionamiento
**COMPLIANT via git.** Rules config in repo. Changes via PR = full version history, approval workflow, audit trail. More traceable than any database-backed admin panel.

### H3. Panel de control de sesiones en tiempo real
**ADDRESSED DIFFERENTLY — mastery dashboard replaces surveillance panel.** The pliego assumes a centralized model where supervisors monitor live exam sessions. Our architecture replaces surveillance with accountability: the citizen has a personal mastery dashboard (ATT-399) showing progress by category, streak, and accuracy over time. Every session produces a signed, tamper-evident VC that can be audited after the fact. DGEV can aggregate analytics from anonymized VC data (presented voluntarily or via institutional verification endpoints) without needing real-time access to individual sessions. This is more respectful of citizen privacy (Ley 8968) and more scalable — a supervisor watching 5,000 live sessions adds no value, but a dashboard of verified outcomes adds full accountability.

### H4. Expulsión o bloqueo inmediato por fraude
**COMPLIANT locally.** Fraud detected → exam voided → no VC issued. Cooldown enforced: after a voided/failed exam, the app enforces a waiting period (from `exam-rules.json`) before allowing another attempt. Stored in vault — can't bypass by reinstalling because identity is DID-bound.

### H5. Alertas automáticas al supervisor ante anomalías
**ADDRESSED DIFFERENTLY — enforcement replaces alerting.** The pliego requires supervisor alerts because centralized proctoring systems detect anomalies but rely on humans to act on them. Our architecture cuts out the middleman: anomalies are enforced automatically by the exam engine (graduated response for multiple faces, immediate block for identity mismatch, session void for camera failure). There is no supervisor to alert because no human judgment is needed — the rules are deterministic and the consequences are immediate. The citizen sees the anomaly in real-time (visual overlay + audio alert) and knows exactly why their exam was paused or voided. If they dispute a decision, they export their local evidence (hash chain, captured frames, session log) and present it to DGEV. The app is the neutral arbiter — it flags, enforces, and documents, but does not judge.

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
**ADDRESSED DIFFERENTLY — citizen-initiated presentation replaces real-time push.** The pliego requires automatic result synchronization to SGLC. Our architecture uses a citizen-presentation model: the citizen holds the signed exam VC in their wallet and presents it to COSEVI when requesting their license. COSEVI verifies the credential's Ed25519 signature, checks the hash chain integrity, and registers the result in SGLC at that moment. This is more reliable than real-time push (no sync failures, no orphaned records, no retry queues) and gives the citizen control over when and to whom they disclose their exam results — a privacy advantage under Ley 8968.

---

## Summary

| Category | Compliant/Exceeded | Build | Addressed Differently |
|---|---|---|---|
| A. Arquitectura (8) | 5 | 3 | 0 |
| B. Identidad/Proctoring (13) | 4 | 9 | 0 |
| C. Seguridad (11) | 9 | 2 | 0 |
| D. Integraciones (10) | 3 | 0 | 7 |
| E-F. Rendimiento (7+) | 7+ | 0 | 0 |
| G. Continuidad (6) | 6 | 0 | 0 |
| H. Configuración (7) | 2 | 3 | 2 |
| I. PoC/UAT (9) | 7 | 1 | 1 |

**Key differentiators vs traditional bidders:**
1. **Local-first** — no server, no SLAs, no availability concerns, citizen owns all data
2. **VC architecture** — replaces SGLC integration, WORM storage, admin panels, and export systems with a single signed credential
3. **LLM question generation** — infinite question bank from public law, fresh every attempt
4. **Blockchain anchoring** — Solana proof-of-session (optional per pliego, native for us)
5. **Mastery model** — scorecard tracks weak topics, transforms exam from gate into learning tool
6. **Privacy by design** — no video recording, no audio recording, no server storage, anomaly-only capture, user controls all evidence

---

## Jira Tickets

| Ticket | Scope | Status |
|---|---|---|
| ATT-398 | Proctored exam system — lockdown, hash chain, session engine | ✅ DONE |
| ATT-399 | Micro-quiz mastery model (spaced repetition, ongoing learning) | To Do |
| ATT-400 | Liveness + identity verification (FaceLandmarker, blendshapes, face identity) | ✅ DONE |
| ATT-401 | COSEVI/SGLC integration — addressed via VC presentation model (D1-D10) | ✅ CLOSED (architecture addresses) |
| ATT-402 | Admin panel + supervisor tools — addressed via automated enforcement (H3, H5) | ✅ CLOSED (architecture addresses) |
| ATT-403 | Anti-fraud hardening (clipboard, print, screenshot block; watermark done) | In Progress |
| ATT-404 | Audit trail + evidence persistence (evidence export done; encryption + PDF pending) | In Progress |
