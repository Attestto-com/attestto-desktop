# UX — Attestto App

**The citizen's sovereign wallet.** Identity, credentials, documents, money, exams — one app, any country.

Single codebase: PWA (`app.attestto.com`) + Electron (desktop embeds PWA).
Country-specific features delivered as installable modules.

---

## Architecture

```
attestto-app (core shell)
  ├── Vault (DID, keys, biometric, passkey unlock)
  ├── Inbox (pending tasks, activity feed)
  ├── Wallet (credentials, documents, money)
  ├── Modules (country plugins + universal tools)
  └── AI (on-device LLM for document explanation + exam generation)

Country modules (plugins):
  🇨🇷 CR: cédula, COSEVI exam, Firma Digital, Padrón, SINPE/CRC
  🇧🇷 BR: CPF, DETRAN, ICP-Brasil, PIX/BRL
  🇲🇽 MX: CURP/INE, SCT, SAT, SPEI/MXN
  🌐 Core: vault, PDF, verify, pay, AI (country-agnostic)
```

Multi-country support: user installs multiple modules. One DID, multiple jurisdictions.
All credentials visible at once. Context-aware surfacing by locale/GPS.

---

## Screen Map

### 1. Lock Screen

```
┌──────────────────────────────┐
│                              │
│                              │
│                              │
│          ● Attestto          │
│                              │
│         [Fingerprint]        │
│                              │
│     Desbloquear con          │
│     biométrico o PIN         │
│                              │
│                              │
│                              │
│                              │
└──────────────────────────────┘
```

- Same unlock as desktop (passkey / biometric / PIN)
- Shows on every app open
- No content visible until authenticated
- Vault remains encrypted until unlock

---

### 2. Home — Inbox

The HP is a task-driven inbox. Nothing static. Shows what needs attention NOW.

```
┌──────────────────────────────┐
│  ● Attestto        🔔  👤    │
│                              │
│  Hola, Eduardo               │
│                              │
│  ── Pendiente ────────────── │
│                              │
│  ┌────────────────────────┐  │
│  │ 📄 Contrato de arriendo│  │
│  │ Firma requerida         │  │
│  │ De: Bufete Durango      │  │
│  │              Firmar →   │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 🚗 Examen disponible   │  │
│  │ Último: 72% (ayer)      │  │
│  │ Temas débiles: 2        │  │
│  │           Practicar →   │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ ⚠️ Dictamen por vencer  │  │
│  │ Vence en 12 días        │  │
│  │            Renovar →    │  │
│  └────────────────────────┘  │
│                              │
│  ── Reciente ─────────────── │
│                              │
│  ✅ Firmaste contrato.pdf  2h│
│  📸 Selfie capturada     hoy │
│  🚗 Examen: 72%          ayer│
│                              │
│  ── Acciones rápidas ─────── │
│                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │ 📷   │ │  💳  │ │  ✅  │ │
│  │Escan.│ │ Pagar│ │Verif.│ │
│  └──────┘ └──────┘ └──────┘ │
│                              │
│ ┌────┬──────┬──────┬──────┐  │
│ │ 🏠 │  💼  │  📄  │  ⚙️  │  │
│ │Home│Wallet│ Docs │  Más │  │
│ └────┴──────┴──────┴──────┘  │
└──────────────────────────────┘
```

**Inbox items appear when:**
- Document waiting for signature (deeplink or shared)
- Exam cooldown expired (can retry)
- Credential expiring soon
- Payment request received (QR deeplink)
- New VC issued to you
- Module update available

**Inbox empty = all good.** Shows "Todo al día ✅" with recent activity only.

**Quick actions (always visible):**
- 📷 Escanear — open camera for QR scan (triggers: verify credential, receive VC, pay, open deeplink)
- 💳 Pagar — Attestto Pay (if accounts configured)
- ✅ Verificar — scan/verify someone else's credential

---

### 3. Wallet

```
┌──────────────────────────────┐
│  ← Wallet                   │
│                              │
│  ┌─── Tabs ───────────────┐  │
│  │ Credenciales │ Cuentas  │  │
│  └─────────────────────────┘  │
│                              │
│  ── 🇨🇷 Costa Rica ───────── │
│                              │
│  ┌────────────────────────┐  │
│  │ 🪪 Cédula de Identidad  │  │
│  │ ••••••0501              │  │
│  │ ✅ Verificada            │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 🏥 Dictamen Médico      │  │
│  │ Dr. Rodríguez           │  │
│  │ Vence: 2026-10-15       │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 🚗 Prueba Teórica       │  │
│  │ ⏳ En progreso (68%)     │  │
│  └────────────────────────┘  │
│                              │
│  ── 🇺🇸 United States ────── │
│                              │
│  ┌────────────────────────┐  │
│  │ 🛂 Passport              │  │
│  │ Expires: 2031-08-22     │  │
│  └────────────────────────┘  │
│                              │
│  ── Cuentas (tab) ────────── │
│                              │
│  ┌────────────────────────┐  │
│  │ 💵 USD     $1,240.00    │  │
│  │ 🇨🇷 CRC    ₡312,500     │  │
│  │ 💶 EUR     €890.00      │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

**Credentials tab:**
- Grouped by country (auto-detected from VC issuer)
- Each card: type, key identifier (masked), status badge, expiry
- Tap → full credential detail + QR for presentation
- Multi-country: sections for each jurisdiction

**Accounts tab:**
- Currency balances (Attestto Pay — Circle USDC, CRC via Zunify, etc.)
- Tap → transaction history, send, receive

---

### 4. Documents

```
┌──────────────────────────────┐
│  ← Documentos                │
│                              │
│  ┌────────────────────────┐  │
│  │ 📄 Contrato de arriendo│  │
│  │ ⏳ Pendiente de firma   │  │
│  │ Recibido: hoy, 10:32   │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 📄 Declaración jurada   │  │
│  │ ✅ Firmado              │  │
│  │ Firmado: ayer, 15:20    │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 📄 Poder especial       │  │
│  │ ✅ Firmado + anclado ⛓  │  │
│  │ Firmado: 2026-04-08     │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │  ➕ Abrir documento     │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

**Tap on a document → PDF Viewer:**

---

### 5. PDF Viewer + Signer + AI Explainer

```
┌──────────────────────────────┐
│  ← Contrato de arriendo  ⋮  │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │                        │  │
│  │    [PDF RENDERED]      │  │
│  │                        │  │
│  │    Page 1 of 4         │  │
│  │                        │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  ┌─────────┐ ┌────────────┐ │
│  │ 🤖      │ │  ✍️        │ │
│  │Explicar │ │  Firmar    │ │
│  └─────────┘ └────────────┘ │
│                              │
└──────────────────────────────┘
```

**"Explicar" (AI) → bottom sheet:**

```
┌──────────────────────────────┐
│                              │
│  🤖 Asistente Attestto       │
│                              │
│  Este es un contrato de      │
│  arrendamiento por 12 meses  │
│  para un local en San José.  │
│                              │
│  Puntos importantes:         │
│                              │
│  • Renta: ₡450,000/mes      │
│  • Depósito: 2 meses        │
│  • Penalidad salida: 3 meses│
│  • Cláusula 8: el arrendador│
│    puede rescindir con 30    │
│    días de aviso             │
│                              │
│  ⚠️ Atención: la cláusula 12 │
│  limita modificaciones al    │
│  local sin autorización      │
│  escrita.                    │
│                              │
│  ¿Tenés alguna pregunta      │
│  sobre este documento?       │
│                              │
│  ┌────────────────────────┐  │
│  │ Preguntá algo...       │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

**Elements:**
- On-device LLM reads the PDF text
- Summarizes key terms in plain Spanish
- Highlights risks/obligations
- User can ask follow-up questions
- Context-aware: knows user's identity, jurisdiction, credential status
- All local — document never leaves device

**"Firmar" → signing flow:**

```
┌──────────────────────────────┐
│                              │
│  ✍️ Firmar documento          │
│                              │
│  Contrato de arriendo.pdf    │
│  4 páginas, 2.1 MB           │
│                              │
│  Firmante:                   │
│  Eduardo Chongkan            │
│  did:sns:eduardo.sol         │
│                              │
│  Nivel: Self-attested        │
│  Razón: Aceptación de        │
│         términos             │
│                              │
│  ☑ He leído y entiendo       │
│    este documento            │
│                              │
│  ┌────────────────────────┐  │
│  │  🔐 Firmar con vault    │  │
│  └────────────────────────┘  │
│                              │
│  Confirmar con biométrico    │
│                              │
└──────────────────────────────┘
```

---

### 6. Attestto Pay (QR deeplink raise)

When user scans a payment QR or receives a deeplink:

```
┌──────────────────────────────┐
│                              │
│  (blurred app behind)        │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  💳 Attestto Pay        │  │
│  │                        │  │
│  │  Pago a:               │  │
│  │  Restaurante El Patio  │  │
│  │                        │  │
│  │  ┌──────────────────┐  │  │
│  │  │                  │  │  │
│  │  │    ₡12,500       │  │  │
│  │  │                  │  │  │
│  │  └──────────────────┘  │  │
│  │                        │  │
│  │  Desde: CRC ₡312,500  │  │
│  │                        │  │
│  │  ┌──────────────────┐  │  │
│  │  │ 🔐 Confirmar pago│  │  │
│  │  └──────────────────┘  │  │
│  │                        │  │
│  │      Cancelar          │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

- Slides up as bottom sheet over current screen
- Shows merchant, amount, source account
- Biometric confirm to authorize
- DID signs the payment intent → CORTEX+Circle executes (identity and financial keys separate per Attestto Pay model)

---

### 7. Credential Presentation (QR deeplink raise)

When someone requests a credential (e.g., traffic officer scans QR):

```
┌──────────────────────────────┐
│                              │
│  (blurred app behind)        │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │  🪪 Presentar credencial│  │
│  │                        │  │
│  │  Solicitado por:       │  │
│  │  Policía de Tránsito   │  │
│  │                        │  │
│  │  Solicita:             │  │
│  │  ☑ Licencia de conducir│  │
│  │  ☑ Nombre completo     │  │
│  │  ☐ Dirección (opcional)│  │
│  │                        │  │
│  │  Selective disclosure: │  │
│  │  solo comparte lo      │  │
│  │  marcado ☑             │  │
│  │                        │  │
│  │  ┌──────────────────┐  │  │
│  │  │ 🔐 Compartir     │  │  │
│  │  └──────────────────┘  │  │
│  │                        │  │
│  │      Rechazar          │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

- Selective disclosure — user chooses exactly which attributes to share
- Biometric confirm
- Sends only selected fields (not the full credential)
- Verifier gets a signed presentation, verifiable against DID

---

### 8. Verify (scan someone else's credential)

```
┌──────────────────────────────┐
│  ← Verificar                 │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │    [CAMERA VIEWFINDER] │  │
│  │                        │  │
│  │    Escaneá el QR de    │  │
│  │    la credencial       │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  (after scan:)               │
│                              │
│  ┌────────────────────────┐  │
│  │ ✅ CREDENCIAL VÁLIDA    │  │
│  │                        │  │
│  │ Tipo: Licencia B1      │  │
│  │ Titular: Juan Mora     │  │
│  │ Emisor: COSEVI         │  │
│  │ Vigente: Sí            │  │
│  │ Firma: ✅ válida        │  │
│  │ Ancla: ⛓ Solana ✅      │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

---

### 9. Modules / Explore

```
┌──────────────────────────────┐
│  ← Módulos                   │
│                              │
│  ── Instalados ───────────── │
│                              │
│  ┌────────────────────────┐  │
│  │ 🇨🇷 Costa Rica   v1.2  │  │
│  │ Cédula, COSEVI, Firma  │  │
│  │ Digital, Padrón        │  │
│  └────────────────────────┘  │
│                              │
│  ── Disponibles ──────────── │
│                              │
│  ┌────────────────────────┐  │
│  │ 🇧🇷 Brasil        Nuevo│  │
│  │ CPF, DETRAN, ICP-Brasil│  │
│  │           Instalar →   │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 🇲🇽 México              │  │
│  │ CURP, INE, SAT         │  │
│  │           Próximamente  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 🇵🇦 Panamá              │  │
│  │ Cédula, SPA            │  │
│  │           Próximamente  │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

---

### 10. Settings / Profile

```
┌──────────────────────────────┐
│  ← Perfil                    │
│                              │
│  ┌────────────────────────┐  │
│  │ 👤 Eduardo Chongkan     │  │
│  │ did:sns:eduardo.sol     │  │
│  │ 🇨🇷 🇺🇸                  │  │
│  └────────────────────────┘  │
│                              │
│  Seguridad                   │
│    Biométrico          ✅ On │
│    PIN de respaldo     ✅ On │
│    Backup guardian     ✅ 2/3│
│                              │
│  Accesibilidad               │
│    Alto contraste      Off   │
│    Asistente de voz    Off   │
│    Tamaño de texto     Normal│
│                              │
│  Datos y privacidad          │
│    Exportar vault      →     │
│    Exportar evidencia  →     │
│    Eliminar datos      →     │
│                              │
│  Módulos instalados          │
│    🇨🇷 Costa Rica v1.2  →    │
│                              │
│  Acerca de                   │
│    Versión 1.0.0             │
│    Licencia Apache 2.0       │
│                              │
└──────────────────────────────┘
```

---

## Bottom Navigation

```
┌──────┬──────┬──────┬──────┐
│  🏠  │  💼  │  📄  │  ⚙️  │
│ Home │Wallet│ Docs │ Más  │
└──────┴──────┴──────┴──────┘
```

- **Home:** Inbox (tasks + activity + quick actions)
- **Wallet:** Credentials + Accounts (tabs)
- **Docs:** Documents (PDFs, pending signatures)
- **Más:** Modules, Settings, Profile, Verify

---

## Overlay Sheets (raised by deeplinks / QR scans)

These are NOT full screens — they slide up over the current view:

- **Attestto Pay** — payment confirmation (QR deeplink)
- **Credential Presentation** — selective disclosure (verification request)
- **Receive Credential** — accept incoming VC (offer deeplink from verify.attestto.com)

---

## Module: Exam Flow (separate spec)

See `ux-screens-exam.md` for the exam module's 7 internal screens.
The exam module plugs into this app as:
- A mastery widget on the Home inbox
- A card in the Modules screen
- A VC in the Wallet on completion

---

## Color System

| Element | Color | Usage |
|---|---|---|
| Background | #0f1923 | Base dark |
| Card surface | #1a1f2e | Cards, inputs |
| Primary accent | #594FD3 | Buttons, links, selected |
| Success | #4ade80 | Verified, correct, valid |
| Warning | #f97316 | Expiring, wrong, attention |
| Alert | #fbbf24 | Anomaly, pending |
| Critical | #ef4444 | Invalid, failed, blocked |
| Text primary | #e2e8f0 | Body text |
| Text muted | #94a3b8 | Captions, secondary |
| CRC | #003da5 | Costa Rica colón accent |
| USD | #22c55e | Dollar accent |

---

## Key Interactions

- **QR scan → route:** camera decodes QR → deeplink router determines action (pay / verify / receive VC / present credential)
- **Push notification → inbox item:** notification tap opens the relevant inbox card
- **Biometric gate:** every sensitive action (sign, pay, present, export) requires biometric confirmation
- **Offline-first:** everything works without internet. Sync when connected.
- **AI explainer:** available on any document or credential. "¿Qué significa esto?" button.
