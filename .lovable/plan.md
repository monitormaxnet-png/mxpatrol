

## Diagnosis: Why NFC Scanning Fails on the RG360

The NFC scanner relies on the **Web NFC API (`NDEFReader`)**, which has very strict requirements. Looking at `src/hooks/useNfcReader.ts`:

```ts
const supported = typeof window !== "undefined" && "NDEFReader" in window;
```

If `NDEFReader` isn't on `window`, the hook immediately returns `unsupported` and refuses to scan. This is almost certainly what's happening on the RG360.

### Root causes (in order of likelihood)

1. **Web NFC is Chrome-on-Android only.** It does NOT work in:
   - Native APK WebViews (including Capacitor's default `WebView`) — even though the device has NFC hardware, the WebView doesn't expose `NDEFReader`.
   - Firefox, Samsung Internet, or any non-Chromium browser.
   - iOS (Safari has no Web NFC).
   
   The RG360 is being accessed via the **Lovable APK / Capacitor WebView**, which is why `NDEFReader` is `undefined` → status falls to `unsupported` → no scanning happens.

2. **Requires HTTPS + Chrome 89+**. The published URL `https://mxpatrol.lovable.app` is HTTPS ✓, so that's fine in a real Chrome browser — but irrelevant inside a WebView.

3. **No native NFC bridge.** The app currently has no Capacitor plugin (e.g. `@capacitor-community/nfc` or a custom Android intent handler) to read NFC tags from native code and forward them to the WebView.

### What you're seeing

The scanner ring shows "NFC Not Available — Use manual scan mode instead" (the `unsupported` status branch in `ScannerRing.tsx`), even though the RG360 has working NFC hardware.

---

## Fix Plan

Two options — pick one. I recommend **Option A** for the RG360 since it's a dedicated patrol device.

### Option A — Native NFC bridge via Capacitor plugin (recommended)

Build a thin native NFC reader that pushes tag IDs into the existing scan pipeline:

1. **Add Capacitor + NFC plugin** to the project:
   - Install `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`
   - Install `@capawesome-team/capacitor-nfc` (maintained, supports tag UID reading on Android)
   - Initialize Capacitor with `appId: app.lovable.7a762bd665c04e6d941783744dd932b0`, `appName: mxpatrol`
   - Configure `capacitor.config.ts` to point `server.url` at `https://mxpatrol.lovable.app`

2. **Extend `useNfcReader.ts`** with a runtime check:
   - Detect Capacitor (`window.Capacitor?.isNativePlatform()`)
   - If native → use the Capacitor NFC plugin's `addListener('nfcTagScanned', ...)` and call `startScanSession()`
   - If browser with `NDEFReader` → keep current path
   - Otherwise → `unsupported`
   - Both branches emit the same `{ serialNumber, timestamp }` payload, so `useNfcScanProcessor` and the UI need no other changes.

3. **Update `ScannerRing` copy** for the `unsupported` state to mention "Open in Chrome on Android, or use the native APK build."

4. **Document for the user**: After this lands, they'll need to git-pull, run `npx cap sync android`, rebuild the APK, and reinstall on the RG360.

### Option B — Document the limitation (no code change)

If they don't want to maintain a native build:
- Tell guards to open `https://mxpatrol.lovable.app` directly in **Chrome for Android** (not the APK).
- Update the `unsupported` message to say exactly that.
- Keep the manual fallback as the primary entry path inside the APK.

---

## Files to change (Option A)

- `package.json` — add Capacitor + NFC plugin deps
- `capacitor.config.ts` (new) — appId/appName/server URL
- `src/hooks/useNfcReader.ts` — add native branch
- `src/components/scanner/ScannerRing.tsx` — clearer `unsupported` copy
- Memory updates — document the dual-mode reader

---

## Question before I proceed

Which path do you want?

