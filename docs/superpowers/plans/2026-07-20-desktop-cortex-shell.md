# Desktop → CORTEX Shell Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `attestto-desktop` (Electron + Vue 3 + Quasar) app shell — top bar, sidebar, user menu, and dashboard/onboarding — look and behave just like the CORTEX web app (`CORTEX/frontend`, Astro + Vue 3 + Tailwind 4) for brand consistency. The desktop is the flagship branding surface.

**Architecture:** Port CORTEX's Vue SFC shell components into the desktop renderer. Both are Vue 3, so port near-verbatim. To reproduce CORTEX's Tailwind-based styling faithfully, add **Tailwind 4 + `@heroicons/vue`** to the desktop and copy CORTEX's design-token CSS variables, so copied components (which use Tailwind utilities + `var(--color-*)`) render identically. Tailwind coexists with Quasar (preflight disabled so it never resets Quasar components). Existing views (unlock, pdf, cedula, mesh) keep working — only the shell and dashboard change.

**Tech Stack:** Electron 39, Vue 3, Quasar 2.19, Vite (electron-vite), TypeScript, + NEW: Tailwind CSS 4 (`@tailwindcss/vite`), `@heroicons/vue` 2.x.

## Global Constraints

- **Brand color is VIOLET, not navy.** The live CORTEX UI (see reference screenshots) and the current desktop both use primary **`#7c3aed`** (dark variant `#6d28d9`). CORTEX's `src/style.css` may show `#1E3A5F` navy as a base token, but the deployed/whitelabel theme is violet. **Before syncing tokens, open `CORTEX/frontend/src/style.css` and confirm the *actual* current `--color-primary`; if it is violet use it, if navy OVERRIDE to `#7c3aed`.** Never switch the desktop to navy.
- **Tailwind must not break Quasar.** Tailwind 4's preflight/reset conflicts with Quasar's base styles. Disable Tailwind preflight (Task 0). After adding Tailwind, the existing Quasar views (VaultUnlock, Pdf, CedulaVerification, Onboarding) must still render correctly — verify visually each task that touches global CSS.
- **Desktop is single-user + local.** There are NO organizations and NO CORTEX server session in the desktop. The org switcher is cosmetic only (a static "Personal" badge) or omitted. The notification bell's data source is local/mesh, not CORTEX SSE — build the UI + store with a pluggable source and a stub; the real source is an open decision (see Task 3).
- **Preserve all routes, IPC, vault, and mesh logic.** This is a reskin of the shell, not a rewrite of behavior. Every existing route and `presenciaAPI` call must keep working.
- **macOS titlebar:** the desktop header sits below a 28px draggable titlebar region (existing). Keep that.
- **i18n:** desktop is Spanish-primary (Costa Rica). Keep the existing i18n; the LanguageSwitcher is additive (EN/ES).
- **Icons:** migrate the SHELL to `@heroicons/vue` via an `AppIcon` wrapper (ported from CORTEX). Non-shell views may keep Quasar Material Icons for now.
- **Commits:** commit as Eduardo Chongkan; NO `Co-Authored-By` trailer. Commit after each task passes verification. Never push unless asked.

## Reference: CORTEX source components (read-only, copy FROM these)

| Piece | CORTEX source (read-only) | Desktop target |
|---|---|---|
| Design tokens | `CORTEX/frontend/src/style.css` (`:root` CSS vars, ~lines 9-43) | `src/renderer/assets/app.scss` + new `tokens.css` |
| Icon wrapper | `CORTEX/frontend/src/components/ui/AppIcon.vue` | `src/renderer/components/ui/AppIcon.vue` |
| App shell / header | `CORTEX/frontend/src/layouts/AppLayout.vue` (header ~173-220) | `src/renderer/App.vue` (header ~153-321) |
| Sidebar | `CORTEX/frontend/src/components/layout/AppLayoutSidebar.vue` | `src/renderer/App.vue` (drawer ~325-392) |
| User menu | `CORTEX/frontend/src/components/layout/UserMenu.vue` | `src/renderer/App.vue` (dropdown ~201-318) |
| Notifications | `CORTEX/frontend/src/components/layout/NotificationDropdown.vue` | new `src/renderer/components/shell/NotificationBell.vue` |
| Language switch | `CORTEX/frontend/src/components/ui/LanguageSwitcher.vue` | new `src/renderer/components/shell/LanguageSwitcher.vue` |
| Org badge | `CORTEX/frontend/src/components/governance/OrgHeaderBadge.vue` | cosmetic static badge (or omit) |
| Command palette (⌘K) | `CORTEX/frontend/src/components/**/AppCommandPalette.vue` | new `src/renderer/components/shell/CommandPalette.vue` |
| Dashboard | `CORTEX/frontend/src/views/dashboard/DashboardPage.vue` | new `src/renderer/views/DashboardPage.vue` |
| Onboarding checklist | `CORTEX/frontend/src/components/onboarding/OnboardingChecklist.vue` | new `src/renderer/components/dashboard/OnboardingChecklist.vue` |

Desktop token file: `src/renderer/assets/app.scss` (violet tokens, ~lines 4-58). Quasar vars: `src/renderer/assets/quasar-variables.scss`.

---

### Task 0: Add Tailwind 4 + Heroicons + CORTEX tokens (foundation)

**Files:**
- Modify: `package.json` (add `tailwindcss@^4`, `@tailwindcss/vite`, `@heroicons/vue@^2`)
- Modify: `electron.vite.config.ts` (add the Tailwind Vite plugin to the renderer config)
- Create: `src/renderer/assets/tailwind.css` (`@import "tailwindcss";` with preflight disabled)
- Create: `src/renderer/assets/tokens.css` (CORTEX `--color-*` tokens, primary forced to violet)
- Modify: `src/renderer/main.ts` (import `tailwind.css` and `tokens.css`)
- Create: `src/renderer/components/ui/AppIcon.vue` (port of CORTEX AppIcon)

**Interfaces:**
- Produces: global `--color-primary`, `--color-bg-*`, `--color-text-*`, `--color-border` CSS vars; Tailwind utility classes available in `.vue` templates; `<AppIcon name="ShieldCheckIcon" class="h-5 w-5" />`.

- [ ] **Step 1: Confirm CORTEX's actual primary color.** Open `CORTEX/frontend/src/style.css`; read the `--color-primary` value and whether a whitelabel/violet override exists. Record the value. Regardless of what you find, the desktop primary stays **`#7c3aed`** (see Global Constraints).

- [ ] **Step 2: Add deps.** Add to `package.json` dependencies: `"tailwindcss": "^4.0.0"`, `"@tailwindcss/vite": "^4.0.0"`, `"@heroicons/vue": "^2.2.0"`. Run `pnpm install`.

- [ ] **Step 3: Wire Tailwind into the renderer Vite config.** In `electron.vite.config.ts`, import `tailwindcss` from `@tailwindcss/vite` and add it to the `renderer.plugins` array (alongside the existing Vue/Quasar plugins).

- [ ] **Step 4: Create `src/renderer/assets/tailwind.css`** with preflight disabled so Quasar isn't reset:
```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
/* NOTE: tailwindcss/preflight is intentionally NOT imported — it resets Quasar. */
```

- [ ] **Step 5: Create `src/renderer/assets/tokens.css`** — copy CORTEX's `:root` token block from `CORTEX/frontend/src/style.css`, but set the primary to violet:
```css
:root {
  --color-primary: #7c3aed;
  --color-primary-dark: #6d28d9;
  /* copy the remaining --color-accent / --color-success / --color-warning /
     --color-danger / --color-bg-* / --color-text-* / --color-border tokens
     verbatim from CORTEX/frontend/src/style.css */
}
.dark { /* copy CORTEX's .dark overrides, keeping primary violet */ }
```

- [ ] **Step 6: Import both** in `src/renderer/main.ts` (before the app mount, after existing style imports): `import './assets/tokens.css'` then `import './assets/tailwind.css'`.

- [ ] **Step 7: Port `AppIcon.vue`.** Copy `CORTEX/frontend/src/components/ui/AppIcon.vue` to `src/renderer/components/ui/AppIcon.vue` verbatim. It imports from `@heroicons/vue/24/outline` etc. No desktop-specific changes expected.

- [ ] **Step 8: Verify nothing broke.** Run `pnpm type-check`. Then (user launches `pnpm dev`) confirm the existing VaultUnlock, Pdf, and Cedula views still render correctly (Quasar components intact, no reset damage). Confirm a scratch `<div class="text-[color:var(--color-primary)] p-4">test</div>` renders violet.

- [ ] **Step 9: Commit** `feat(desktop): add Tailwind 4 + heroicons + CORTEX design tokens (shell foundation)`.

---

### Task 1: Top bar — CORTEX header layout

**Files:**
- Modify: `src/renderer/App.vue` (replace header content ~lines 153-321 with CORTEX-style header)
- Create: `src/renderer/components/shell/AppHeader.vue` (extract the header into its own component)

**Interfaces:**
- Consumes: existing vault state (`useVaultStore`), theme toggle, settings route.
- Produces: `<AppHeader>` with slots/props for the search trigger, LanguageSwitcher, NotificationBell, org badge, UserMenu (built in later tasks; stub them as empty placeholders for now).

- [ ] **Step 1:** Read `CORTEX/frontend/src/layouts/AppLayout.vue` header region (~173-220) to mirror its structure: left = logo + (search trigger), right (ml-auto) = LanguageSwitcher · NotificationBell · OrgBadge · UserMenu. Note the Tailwind classes (`h-16`, flex, gap, border, `var(--color-*)`).
- [ ] **Step 2:** Create `src/renderer/components/shell/AppHeader.vue` reproducing that layout with Tailwind classes + tokens. Left: the desktop brand logo (`resources/icon.png`) + "AttestTo" wordmark. Center: a search trigger button ("Search… ⌘K") that emits `open-search` (palette wired in Task 5). Right: placeholder slots for `<LanguageSwitcher/>`, `<NotificationBell/>`, org badge (static "Personal" pill), `<UserMenu/>`.
- [ ] **Step 3:** In `App.vue`, replace the old `q-header` inner content with `<AppHeader>` (keep the `q-header` wrapper + the 28px titlebar drag region above it). Keep `isUnlockScreen` logic (header hidden on unlock).
- [ ] **Step 4:** Verify: `pnpm type-check`; header renders with CORTEX proportions (h-16, violet accents), existing pages still reachable.
- [ ] **Step 5:** Commit `feat(desktop): CORTEX-style top bar shell`.

---

### Task 2: LanguageSwitcher

**Files:**
- Create: `src/renderer/components/shell/LanguageSwitcher.vue`

- [ ] **Step 1:** Port `CORTEX/frontend/src/components/ui/LanguageSwitcher.vue` (compact mode: "EN" / "ES" chips, selected = outline ring). Wire it to the desktop's existing i18n (`currentLang`/`setLang` equivalent — locate the desktop i18n; if none, use a simple locale ref). Default locale `es`.
- [ ] **Step 2:** Mount it in `AppHeader.vue`'s right cluster.
- [ ] **Step 3:** Verify toggle switches locale; type-check clean.
- [ ] **Step 4:** Commit `feat(desktop): header language switcher`.

---

### Task 3: NotificationBell + store

**Files:**
- Create: `src/renderer/components/shell/NotificationBell.vue`
- Create: `src/renderer/stores/notifications.ts` (Pinia store; pluggable source)

**Interfaces:**
- Produces: `useNotificationsStore()` with `items`, `unreadCount`, `markAllRead()`, and a `source` seam.

- [ ] **Step 1:** Port `CORTEX/frontend/src/components/layout/NotificationDropdown.vue`: BellIcon + red numeric badge (shows count or "99+"), dropdown with "Notifications" header + "Mark all as read", list items with importance dot (red/amber/blue), title, message (line-clamped), relative timestamp.
- [ ] **Step 2:** Create `stores/notifications.ts`. **Data source is an open decision** (CORTEX API via `@adonisjs/transmit-client` vs desktop mesh events vs local). For now: a local in-memory source seeded with 1–2 sample notifications + a clearly marked `// TODO(source): wire to mesh events or CORTEX transmit` seam. Do NOT fake a server connection.
- [ ] **Step 3:** Mount `<NotificationBell>` in `AppHeader.vue`.
- [ ] **Step 4:** Verify bell shows badge + dropdown; mark-all-read clears the count; type-check clean.
- [ ] **Step 5:** Commit `feat(desktop): notification bell + store (local source seam)`.

---

### Task 4: UserMenu dropdown

**Files:**
- Create: `src/renderer/components/shell/UserMenu.vue`
- Modify: `src/renderer/App.vue` (remove old identity dropdown; use `<UserMenu>`)

- [ ] **Step 1:** Port `CORTEX/frontend/src/components/layout/UserMenu.vue`: trigger = avatar + name + chevron + online dot; dropdown = header card (avatar, name, email, role badge), last-login line, grouped menu items with keyboard-shortcut hints, and a footer "🔒 Secure Session · TLS 1.3 Encrypted" (matches reference image 42).
- [ ] **Step 2:** Map the menu items to **desktop semantics + routes** (not CORTEX's): Account Security → `/settings` (⌘S), Terminal/Preferences → `/settings?tab=preferences` (⌘,), Audit Log → desktop audit route (⌘A), API Keys/DID → `/identity` (⌘K), **End Secure Session → lock vault** (`lockAndRedirect()`, danger, ⌘Q). Header shows the vault identity (name + `cr-….attestto.id` handle) and "End User" role. Keep the locked / no-vault states from the old dropdown (Desbloquear / Crear / Recuperar).
- [ ] **Step 3:** Replace the old `q-btn-dropdown` in `App.vue` with `<UserMenu>`.
- [ ] **Step 4:** Verify all vault states (unlocked / locked / no-vault) work and route correctly; type-check clean.
- [ ] **Step 5:** Commit `feat(desktop): CORTEX-style user menu (desktop vault semantics)`.

---

### Task 5: Command palette (⌘K search)

**Files:**
- Create: `src/renderer/components/shell/CommandPalette.vue`
- Modify: `src/renderer/App.vue` (global ⌘K listener → open palette; `AppHeader` search trigger opens it)

- [ ] **Step 1:** Locate CORTEX's command palette (`AppCommandPalette.vue`) and port a lite version: modal overlay, search input, a static list of desktop destinations (Dashboard, Identity, Credentials, Documents/PDF, Settings, Lock vault) filtered by query; Enter navigates.
- [ ] **Step 2:** Wire ⌘K (and Ctrl+K) global keydown in `App.vue` to toggle it; the header search button opens it too.
- [ ] **Step 3:** Verify ⌘K opens/closes, filtering + navigation work; type-check clean.
- [ ] **Step 4:** Commit `feat(desktop): ⌘K command palette`.

---

### Task 6: Sidebar — CORTEX look

**Files:**
- Modify: `src/renderer/App.vue` (drawer ~325-392) OR extract to `src/renderer/components/shell/AppSidebar.vue`

- [ ] **Step 1:** Read `CORTEX/frontend/src/components/layout/AppLayoutSidebar.vue`: `w-64`/`w-16` widths, logo section, nav groups with collapsible children (accordion), left 3px active accent bar, badge pills, collapse toggle in footer.
- [ ] **Step 2:** Reproduce that look in the desktop sidebar using Tailwind + tokens, mapping to the desktop's real routes/nav (Dashboard, Personal → Profile/Identity Wallet/Documents/Vault/etc., matching reference image 43's sidebar). Keep the existing "Bloquear boveda" + collapse in the footer. Preserve mini/collapsed behavior with tooltips.
- [ ] **Step 3:** Verify nav works, active state + collapse animate, mini mode shows tooltips; type-check clean.
- [ ] **Step 4:** Commit `feat(desktop): CORTEX-style sidebar`.

---

### Task 7: Dashboard page + onboarding UX

**Files:**
- Create: `src/renderer/views/DashboardPage.vue`
- Create: `src/renderer/components/dashboard/OnboardingChecklist.vue`
- Modify: router (`src/renderer/router` or wherever routes are defined) — set `/` (or `/dashboard`) to `DashboardPage` for the unlocked home.

**Interfaces:**
- Consumes: vault identity + credential state (from `useVaultStore` / existing composables) to compute onboarding progress.

- [ ] **Step 1:** Read `CORTEX/frontend/src/views/dashboard/DashboardPage.vue` + `components/onboarding/OnboardingChecklist.vue`. Reproduce (reference image 43): a breadcrumb + "Dashboard / Here's an overview" header; a **"Your Attestto ID"** card ("Identity verified", "N of 2 credentials added" progress bar, "Open Identity Wallet"); a **"Get set up"** checklist of step cards (Complete Your Profile → Add; Add National ID → Done; Add Driver License → Done) with numbered/checkmark icons, description, and CTA/Done badge; a **"My Documents"** section with "View documents".
- [ ] **Step 2:** Build `OnboardingChecklist.vue` driven by real desktop state where possible (identity verified? credentials present? documents?), falling back to sensible defaults. Progress bar uses `--color-primary` (violet).
- [ ] **Step 3:** Wire `DashboardPage` as the unlocked home route; ensure it renders inside the new shell.
- [ ] **Step 4:** Verify the dashboard matches the reference layout, progress reflects state, CTAs navigate; type-check clean.
- [ ] **Step 5:** Commit `feat(desktop): CORTEX-style dashboard + onboarding checklist`.

---

### Task 8: Icon audit — shell on Heroicons

**Files:**
- Modify: the shell components created above (`AppHeader`, `AppSidebar`, `UserMenu`, `NotificationBell`, `CommandPalette`, `DashboardPage`, `OnboardingChecklist`)

- [ ] **Step 1:** Sweep every shell component; replace any remaining Quasar `q-icon` Material icons with `<AppIcon name="…"/>` Heroicons matching CORTEX's choices (BellIcon, ShieldCheckIcon, AdjustmentsHorizontalIcon, ClipboardDocumentListIcon, KeyIcon, ArrowRightOnRectangleIcon, BuildingOffice2Icon, MagnifyingGlassIcon, Bars3Icon, etc. — cross-check against the CORTEX sources listed above).
- [ ] **Step 2:** Verify all shell icons render (no missing-icon boxes); type-check clean.
- [ ] **Step 3:** Commit `refactor(desktop): shell icons on heroicons to match CORTEX`.

---

### Final: whole-branch review

- [ ] Run `pnpm type-check` and `pnpm test` (if shell tests exist) — clean.
- [ ] Launch `pnpm dev` and walk the shell against the reference screenshots (images 40/42/43): header, user menu, sidebar, dashboard/onboarding. Confirm violet branding throughout, no Quasar regressions on unlock/pdf/cedula.
- [ ] Dispatch superpowers:requesting-code-review over the branch diff.
- [ ] Use superpowers:finishing-a-development-branch.

## Open decisions to surface to Eduardo (do NOT guess silently)
1. **Notification source** (Task 3): CORTEX transmit/SSE vs desktop mesh events vs local — needs Eduardo's call. Ship the UI with a local seam meanwhile.
2. **Org badge** (Task 1): keep a cosmetic static "Personal" badge for visual parity, or omit — confirm.
3. **Shared package extraction:** once this proves out, these shell components are candidates for a shared `@attestto/ui` Lit/Vue package consumed by both desktop and CORTEX (per the architecture discussion). Out of scope for this plan — a follow-up.
