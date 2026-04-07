

# Implementation Plan: PWA + Admin Onboarding + Device Onboarding

## Overview

Three features to build: (1) Full PWA with offline support, (2) Admin tenant onboarding wizard for new signups, (3) Improved device onboarding flow.

---

## 1. PWA with Offline Support

**What**: Make the app installable with service worker caching and offline fallback.

**Steps**:
- Install `vite-plugin-pwa` and configure in `vite.config.ts` with `registerType: "autoUpdate"`, `devOptions: { enabled: false }`, and `navigateFallbackDenylist: [/^\/~oauth/]`
- Create `public/manifest.json` with app name "SENTINEL Patrol Intelligence", theme colors matching the dark theme, and PWA icons
- Generate PWA icons (192x192, 512x512) in `public/`
- Add mobile meta tags to `index.html` (`theme-color`, `apple-mobile-web-app-capable`, etc.)
- Add iframe/preview guard in `src/main.tsx` to prevent service worker registration in Lovable preview
- Create `/install` page with install prompt trigger and instructions for iOS (Share > Add to Home Screen)
- Add route to `App.tsx` as a public route

**Offline strategy**: Cache app shell and static assets. API calls fail gracefully with existing offline queue patterns.

---

## 2. Admin Tenant Onboarding Wizard

**What**: A multi-step guided setup that appears after a new admin's first login, walking them through company configuration, team invites, checkpoint setup, first device enrollment, and first patrol creation.

**Database changes**:
- Add `onboarding_completed` boolean column to `profiles` table (default `false`)

**New components**:
- `src/components/onboarding/OnboardingWizard.tsx` — Full-screen modal wizard with 5 steps
- Step 1: **Company Setup** — Name, logo upload, domain
- Step 2: **Invite Team** — Add supervisor/guard emails (stores invites, sends via auth invite or displays signup links)
- Step 3: **Create Checkpoints** — Add 2-3 NFC checkpoint locations with names and coordinates
- Step 4: **Enroll First Device** — Generate a QR enrollment token inline, show QR code to scan with a guard device
- Step 5: **Create First Patrol** — Name, assign guard, pick checkpoints, set schedule

**Integration**:
- In `AppLayout.tsx` or `Index.tsx`, check if `profiles.onboarding_completed` is `false` for admin users — if so, show the wizard
- On wizard completion, update `profiles.onboarding_completed = true`
- Add "Skip" option on each step and a "Complete Later" button

---

## 3. Device Onboarding Flow Improvements

**What**: Enhance the existing `/enroll` page into a polished step-by-step wizard.

**Steps**:
- Refactor `EnrollPage.tsx` into a 3-step flow:
  - Step 1: **Scan or Enter Token** — Camera QR scanner with manual fallback (already exists, polish UI)
  - Step 2: **Confirm Device Info** — Show auto-detected metadata, allow editing device name/type
  - Step 3: **Success + Next Steps** — Show enrolled device details, link to download app or return to dashboard
- Add progress indicator (step dots) at the top
- Improve offline state with clearer messaging and pending count badge
- Add animated transitions between steps

---

## Technical Details

| Area | Files Changed |
|------|--------------|
| PWA | `vite.config.ts`, `index.html`, `src/main.tsx`, new `public/manifest.json`, new `src/pages/InstallPage.tsx` |
| Onboarding | New migration (add `onboarding_completed`), new `src/components/onboarding/OnboardingWizard.tsx` + sub-step components, edit `src/pages/Index.tsx` or `AppLayout.tsx` |
| Device flow | Edit `src/pages/EnrollPage.tsx` |
| Routing | `src/App.tsx` — add `/install` route |

**Dependencies to add**: `vite-plugin-pwa`

