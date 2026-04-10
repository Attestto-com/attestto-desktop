# UX Screens — Módulo de Examen Teórico

**Module of the Attestto PWA** (`mobile.attestto.com` / embedded in desktop via Electron).
This is NOT a standalone app — it's the exam module within the existing Attestto platform.

Dark theme (#0f1923 base), purple accent (#594FD3), green for correct (#4ade80), orange for wrong (#f97316).
Card-based layout, mobile-first, inspired by modern quiz apps but adapted for government exam + proctoring.

---

## Module Boundaries

### What the main Attestto app provides (NOT this module):
- **Navigation shell** — bottom tabs, top bar, routing
- **Identity / vault** — user profile, DID, biometric storage, credentials list
- **Home page** — modules grid, announcements, quick actions
- **Credentials view** — list of all VCs in vault (exam VC appears here after passing)
- **Settings** — camera permissions, language, accessibility preferences
- **Profile** — identity card, cédula/DIMEX verification status

### What this exam module provides:
- **Mastery widget** — embeddable card for the home page (streak, progress, "Iniciar examen" CTA)
- **Exam flow** — consent → pre-exam verify → questions → feedback → result
- **Anomaly overlays** — proctoring alerts during exam
- **VC issuance** — generates the exam VC, hands it to the vault
- **Evidence export** — watermarked PDF + encrypted bundle

### Entry points from the main app:
- Home page → mastery widget → "Iniciar examen" or "Pregunta del día"
- Modules page → "Prueba Teórica" module card
- Credentials page → "Obtener prueba teórica" if not yet earned

---

## Widget: Mastery Card (embedded in home page)

```
┌────────────────────────────┐
│  🚗 Prueba Teórica         │
│                            │
│  🔥 7 días  │  📊 68%  │ 🏆 3│
│                            │
│  Ley 9078      ████░░ 72% │
│  Señalización  ██████ 95% │
│  Mecánica      ███░░░ 55% │
│  ⚠️ 2 temas por mejorar    │
│                            │
│  ┌──────────────────────┐  │
│  │  ▶ INICIAR EXAMEN    │  │
│  └──────────────────────┘  │
│  Último: ayer, 72%         │
│  Próximo: disponible hoy   │
└────────────────────────────┘
```

**Elements:**
- Compact card that the main app's home page renders
- Streak, overall accuracy, tests completed
- Top 3 category bars (show weakest or summary)
- CTA button: "Iniciar examen" (or "Pregunta del día" for micro-quiz mode)
- Cooldown indicator if retry not available
- Vehicle type selector (auto/moto/transporte) if user has multiple

---

## Screen 1: Consentimiento Informado

```
┌──────────────────────────────┐
│                              │
│         ⚖️                   │
│  Consentimiento Informado    │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │ De conformidad con la  │  │
│  │ Ley N.° 8968, durante  │  │
│  │ esta prueba se          │  │
│  │ recopilará:            │  │
│  │                        │  │
│  │ 📸 Captura facial en   │  │
│  │    eventos de anomalía │  │
│  │                        │  │
│  │ 👁 Detección de rostro  │  │
│  │   y presencia          │  │
│  │                        │  │
│  │ 🔒 Registro de eventos │  │
│  │   con hash criptográfico│ │
│  │                        │  │
│  │ 🎤 Detección de        │  │
│  │   actividad de voz     │  │
│  │                        │  │
│  │ Uso exclusivo para     │  │
│  │ verificar identidad e  │  │
│  │ integridad. Sin análisis│  │
│  │ secundarios.           │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │  ✅ Acepto — Continuar  │  │
│  └────────────────────────┘  │
│                              │
│       Rechazar               │
│                              │
└──────────────────────────────┘
```

**Elements:**
- Legal text referencing Ley 8968
- Clear list of what data is collected (icons + plain language)
- Purpose statement (verification only, no secondary use)
- Accept button (primary, blue-6)
- Reject link (returns to home)
- Acceptance timestamp recorded in session

---

## Screen 2: Pre-examen — Verificación

```
┌──────────────────────────────┐
│  ← Atrás                    │
│                              │
│     Verificación previa      │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │    ┌──────────────┐    │  │
│  │    │              │    │  │
│  │    │  [Camera     │    │  │
│  │    │   Preview]   │    │  │
│  │    │              │    │  │
│  │    │   😊 ✅       │    │  │
│  │    └──────────────┘    │  │
│  │                        │  │
│  │  Rostro detectado      │  │
│  │  Identidad confirmada  │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  ✅ Identidad verificada     │
│  ✅ Dictamen médico válido   │
│  ✅ Cámara activa            │
│  ✅ Micrófono activo         │
│  ✅ Rostro coincide          │
│  ⏳ Cooldown cumplido        │
│                              │
│  ── Reglas del examen ────── │
│                              │
│  📝 40 preguntas             │
│  ⏱ 40 minutos               │
│  ✅ 80% para aprobar         │
│  🔒 Pantalla bloqueada       │
│  📸 Captura en anomalías     │
│                              │
│  ┌────────────────────────┐  │
│  │   ▶ COMENZAR EXAMEN    │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

**Elements:**
- Camera preview (large, centered) with face detection overlay
- Face match indicator (comparing live face vs stored biometric)
- Checklist: identity ✅, dictamen ✅, camera ✅, mic ✅, face match ✅, cooldown ✅
- Any failing check = button disabled + red indicator with explanation
- Exam rules summary (question count, time, threshold)
- "Comenzar examen" button (disabled until all checks pass)

---

## Screen 3: Pregunta (durante examen)

```
┌──────────────────────────────┐
│ ┌──────┐ ████████░░ ┌─────┐ │
│ │12/40 │            │⏱35:22│ │
│ └──────┘            └─────┘ │
│                              │
│         ┌───┐                │
│         │72 │  ← score       │
│         └───┘                │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  Señalización          │  │
│  │  ─────────────────     │  │
│  │                        │  │
│  │  "¿Por qué una línea   │  │
│  │   amarilla continua    │  │
│  │   prohíbe adelantar?"  │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ Porque la ley lo dice  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ Porque no hay          │  │
│  │ visibilidad del        │  │
│  │ tráfico en sentido     │  │
│  │ contrario              │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ Porque el pavimento    │  │
│  │ está en mal estado     │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ Porque es zona escolar │  │
│  └────────────────────────┘  │
│                              │
│  ┌──┐                       │
│  │📷│ 😊  🔒  🟢            │
│  └──┘                       │
└──────────────────────────────┘
```

**Elements:**
- **Top bar:** question counter (12/40), progress bar, timer (35:22)
- **Score circle:** running score (updates live, like the quiz template)
- **Question card:**
  - Category tag (Señalización, colored)
  - Question text (understanding-based, "¿Por qué...?")
- **Answer cards:** 4 options, tap to select
  - Unselected: dark card, white text
  - Selected: purple border, waiting for confirmation
  - After answer: green (correct) or orange (wrong) with checkmark/X
- **Bottom bar (small, non-intrusive):**
  - Camera pip (tiny thumbnail, 40x40px)
  - Face status icon (😊 = detected, ⚠️ = absent, 🔴 = multiple)
  - Lock icon (🔒 = lockdown active)
  - Connection dot (🟢 = all systems go)
- **No "next" button** — selecting an answer auto-advances after feedback animation (1.5s)

---

## Screen 4: Feedback (after answering)

```
┌──────────────────────────────┐
│ ┌──────┐ ████████░░ ┌─────┐ │
│ │12/40 │            │⏱35:10│ │
│ └──────┘            └─────┘ │
│                              │
│         ┌───┐                │
│         │74 │  ← +2          │
│         └───┘                │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  Señalización          │  │
│  │  ─────────────────     │  │
│  │                        │  │
│  │  "¿Por qué una línea   │  │
│  │   amarilla continua    │  │
│  │   prohíbe adelantar?"  │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ ✅ Porque no hay        │  │
│  │ visibilidad del        │  │ ← green bg
│  │ tráfico en sentido     │  │
│  │ contrario              │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 💡 ¿Por qué?           │  │
│  │                        │  │
│  │ La línea amarilla      │  │
│  │ continua indica que    │  │
│  │ no hay suficiente      │  │
│  │ distancia de           │  │
│  │ visibilidad para       │  │
│  │ adelantar con          │  │
│  │ seguridad. Un          │  │
│  │ adelantamiento aquí    │  │
│  │ podría resultar en     │  │
│  │ colisión frontal.      │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  ── Siguiente en 2s ──────── │
│                              │
└──────────────────────────────┘
```

**Elements:**
- Score animation (+2 points floating up)
- Correct answer highlighted green with ✅
- Wrong answer (if selected) highlighted orange with ✗
- **"¿Por qué?" explanation card** — the `why` field from our understanding-based questions
  - This is the learning moment — the user reads WHY, not just what
  - Auto-advances after 3-4 seconds (or tap to skip)
- If answer was wrong, the explanation helps them learn for next time
- Timer keeps running during feedback

---

## Screen 5: Anomaly Alert (overlay)

```
┌──────────────────────────────┐
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │     ⚠️ ATENCIÓN        │  │
│  │                        │  │
│  │  Se detectaron         │  │
│  │  múltiples personas    │  │
│  │  en la cámara.         │  │
│  │                        │  │
│  │  Asegúrese de estar    │  │
│  │  solo para continuar.  │  │
│  │                        │  │
│  │  Incidente 1 de 3      │  │
│  │                        │  │
│  │  ⏱ Examen pausado      │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  (background: blurred exam)  │
│                              │
└──────────────────────────────┘
```

**Variants:**
- **Yellow (warning):** multiple persons (1st), face absent >5s, gaze off-screen sustained
- **Red (critical):** face mismatch, voice detected, multiple persons (2nd+)
- **Black (terminal):** camera disconnected, 3rd multiple persons, face swap detected
- Each shows incident count ("Incidente 1 de 3")
- Audible beep/tone plays
- Timer pauses on yellow/red, stops on black
- Auto-resumes when condition clears (yellow/red only)

---

## Screen 6: Result Summary

```
┌──────────────────────────────┐
│                              │
│     ┌─────────────────┐      │
│     │                 │      │
│     │    🏆           │      │
│     │                 │      │
│     │  APROBADO       │      │
│     │                 │      │
│     │    32/40        │      │
│     │     80%         │      │
│     │                 │      │
│     └─────────────────┘      │
│                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │ ✅ 32 │ │ ❌ 8  │ │⏱22:15│ │
│  │Correct│ │Wrong │ │Tiempo│ │
│  └──────┘ └──────┘ └──────┘ │
│                              │
│  ── Dominio por tema ─────── │
│                              │
│  Ley 9078          ████░░ 75%│
│  Señalización      ██████ 90%│
│  Seguridad vial    █████░ 85%│
│  Mecánica          ███░░░ 50%│ ← orange
│  Peatones          ████░░ 70%│
│  Velocidad/frenado ██░░░░ 40%│ ← red
│                              │
│  ── Temas débiles ────────── │
│                              │
│  ⚠️ Velocidad/frenado: 40%   │
│  Estudia el capítulo 12 del  │
│  manual para mejorar.        │
│                              │
│  ── Prueba de sesión ─────── │
│                              │
│  🔗 a7f3c9...e4b2d1          │
│  ⏱ 22 min 15 seg             │
│  📸 0 incidentes              │
│                              │
│  ┌────────────────────────┐  │
│  │  📜 Ver Credencial      │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │  📤 Descargar Evidencia │  │
│  └────────────────────────┘  │
│                              │
│       Volver al inicio       │
│                              │
└──────────────────────────────┘
```

**If FAILED:**
- Same layout but with ❌ icon, "REPROBADO", red accent
- "Temas débiles" section prominently shown with study recommendations
- "Próximo intento: mañana" with countdown
- No "Ver Credencial" button
- "Practicar temas débiles" button instead

**Elements:**
- Trophy/X icon based on pass/fail
- Score breakdown (correct, wrong, time)
- Per-category mastery bars (updated with this attempt's data)
- Weak topic recommendations with manual chapter references
- Session proof hash (truncated)
- Incident count
- "Ver Credencial" → opens VC in vault
- "Descargar Evidencia" → watermarked PDF + encrypted evidence bundle

---

## Screen 7: Credencial Emitida

```
┌──────────────────────────────┐
│                              │
│          🎉                  │
│                              │
│  Prueba Teórica Aprobada     │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  CREDENCIAL VERIFICABLE│  │
│  │  ─────────────────     │  │
│  │                        │  │
│  │  Tipo: Prueba Teórica  │  │
│  │  Vehículo: Automóvil B1│  │
│  │  Score: 32/40 (80%)    │  │
│  │  Fecha: 2026-04-10     │  │
│  │                        │  │
│  │  Emisor: Attestto      │  │
│  │  Titular: Eduardo C.   │  │
│  │                        │  │
│  │  ┌──────────────────┐  │  │
│  │  │    [QR CODE]     │  │  │
│  │  │                  │  │  │
│  │  │  Verificar en    │  │  │
│  │  │  verify.attestto │  │  │
│  │  │  .com            │  │  │
│  │  └──────────────────┘  │  │
│  │                        │  │
│  │  🔗 Proof: a7f3...d1   │  │
│  │  ⛓ Solana: tx:8k2f... │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │  📤 Compartir           │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │  🏥 Presentar al COSEVI│  │
│  └────────────────────────┘  │
│                              │
│  Presente esta credencial    │
│  en cualquier sede del       │
│  COSEVI para obtener su      │
│  licencia de conducir.       │
│                              │
└──────────────────────────────┘
```

**Elements:**
- Celebration animation (confetti/particles)
- VC card with all exam details
- QR code → verify.attestto.com (verifiable by anyone)
- Session proof hash
- Solana anchor tx (if anchored)
- "Compartir" → native share sheet (WhatsApp, email, etc.)
- "Presentar al COSEVI" → full-screen QR for scanning at COSEVI office
- Instruction text: what to do next (go to COSEVI with this credential)

---

## Module Flow

```
Main App Home → Mastery Widget → "Iniciar examen"
                                       │
                                       ▼
                              Screen 1: Consentimiento
                                       │
                                       ▼
                              Screen 2: Pre-examen (camera + checks)
                                       │
                                       ▼
                              Screen 3: Pregunta ←──┐
                                       │            │
                                       ▼            │
                              Screen 4: Feedback ───┘ (auto-advance)
                                       │
                                  (on anomaly)
                                       │
                              Screen 5: Anomaly Alert (overlay)
                                       │
                                  (40 questions done or timer expires)
                                       │
                                       ▼
                              Screen 6: Result Summary
                                       │
                                  (if passed)
                                       │
                                       ▼
                              Screen 7: Credencial Emitida
                                       │
                                       ▼
                              Main App → Credentials View (VC in vault)
```

The module takes over the full screen during the exam (lockdown mode). On completion, it returns control to the main app and the VC appears in the credentials list.

---

## Color System

| Element | Color | Usage |
|---|---|---|
| Background | #0f1923 | Base dark |
| Card surface | #1a1f2e | Cards, inputs |
| Primary accent | #594FD3 | Buttons, links, selected |
| Correct | #4ade80 | Right answer, pass, verified |
| Wrong | #f97316 | Wrong answer, fail |
| Warning | #fbbf24 | Anomaly alerts (yellow) |
| Critical | #ef4444 | Face mismatch, terminal |
| Text primary | #e2e8f0 | Body text |
| Text muted | #94a3b8 | Captions, secondary |

---

## Transitions

- **Answer selected → feedback:** card slides up, color fills (300ms ease)
- **Question → question:** card swipe left (250ms)
- **Anomaly alert:** blur background + overlay slide from bottom (200ms)
- **Result → credential:** confetti particles + card scale-in (500ms)
- **Score increment:** number counter animation (+2 floats up and fades)
